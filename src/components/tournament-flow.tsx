"use client";

/* eslint-disable @next/next/no-img-element */

import QRCode from "qrcode";
import { InfoHint } from "@/components/info-hint";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  Match,
  MatchScore,
  Participant,
  PlayerSlot,
  Team,
  TournamentFormat,
  TournamentState,
} from "@/lib/tournament";
import {
  getTournamentStructure,
  isPointsOnlyMatchFormat,
  isTeamComplete,
} from "@/lib/tournament";

interface TournamentFlowProps {
  initialState: TournamentState;
  networkBaseUrls?: string[];
}

interface FeedbackState {
  tone: "success" | "error";
  text: string;
}

interface SetupFormState {
  title: string;
  teamCount: string;
  vacasPerMatch: string;
  gamesPerVaca: string;
  targetPoints: string;
  publicBaseUrl: string;
  format: TournamentFormat;
}

interface ResultDraft {
  teamA: {
    vacas: string;
    games: string;
    points: string;
  };
  teamB: {
    vacas: string;
    games: string;
    points: string;
  };
}

interface SwissColumnBox {
  label: string;
  matches: Match[];
  revealedMatches: Match[];
  hiddenMatches: Match[];
  teams: Team[];
  isEditable: boolean;
}

interface SwissColumn {
  depth: number;
  boxes: SwissColumnBox[];
}

type Screen = "url" | "setup" | "registration" | "swiss" | "topcut";

function subscribeToNothing(): () => void {
  return () => {};
}

function getViewportProfileSnapshot(): {
  width: number;
  height: number;
  density: "compact" | "balanced" | "spacious";
} {
  if (typeof window === "undefined") {
    return { width: 1920, height: 1080, density: "balanced" };
  }

  const width = Math.round(window.visualViewport?.width ?? window.innerWidth);
  const height = Math.round(window.visualViewport?.height ?? window.innerHeight);
  const area = width * height;
  const shortestSide = Math.min(width, height);
  const density =
    height < 820 || width < 1360
      ? "compact"
      : area >= 1920 * 1000 && shortestSide >= 1000
        ? "spacious"
        : "balanced";

  return { width, height, density };
}

function useViewportProfile(): ReturnType<typeof getViewportProfileSnapshot> {
  const [profile, setProfile] = useState(getViewportProfileSnapshot);

  useEffect(() => {
    function handleResize(): void {
      setProfile(getViewportProfileSnapshot());
    }

    window.addEventListener("resize", handleResize);
    window.visualViewport?.addEventListener("resize", handleResize);
    handleResize();

    return () => {
      window.removeEventListener("resize", handleResize);
      window.visualViewport?.removeEventListener("resize", handleResize);
    };
  }, []);

  return profile;
}

function getBrowserOriginSnapshot(): string {
  return typeof window === "undefined" ? "" : window.location.origin;
}

function buildSetupForm(state: TournamentState): SetupFormState {
  return {
    title: state.config.title,
    teamCount: String(state.config.teamCount),
    vacasPerMatch: String(state.config.vacasPerMatch),
    gamesPerVaca: String(state.config.gamesPerVaca),
    targetPoints: String(state.config.targetPoints),
    publicBaseUrl: state.config.publicBaseUrl,
    format: state.config.format,
  };
}

function buildResultDraft(match: Match): ResultDraft {
  return {
    teamA: {
      vacas: String(match.score?.teamA.vacas ?? 0),
      games: String(match.score?.teamA.games ?? 0),
      points: String(match.score?.teamA.points ?? 0),
    },
    teamB: {
      vacas: String(match.score?.teamB.vacas ?? 0),
      games: String(match.score?.teamB.games ?? 0),
      points: String(match.score?.teamB.points ?? 0),
    },
  };
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBaseUrlInput(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function isLocalhostLike(origin: string): boolean {
  return origin.includes("localhost") || origin.includes("127.0.0.1");
}

function playerName(team: Team, index: number): string {
  const player = team.players[index];
  return player?.name?.trim() || `Jugador ${index + 1}`;
}

function formatSyncTime(updatedAt: string): string {
  const parsed = new Date(updatedAt);

  if (Number.isNaN(parsed.getTime())) {
    return "--:--:--";
  }

  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Europe/Madrid",
  }).format(parsed);
}

function formatStageLabel(stage: TournamentState["stage"]): string {
  switch (stage) {
    case "swiss":
      return "Swiss Stage";
    case "semifinals":
      return "Semifinales";
    case "final":
      return "Final";
    case "completed":
      return "Completado";
    case "setup":
    default:
      return "Preparación";
  }
}

function parseRecordLabel(label: string): { wins: number; losses: number } {
  const [wins, losses] = label.split("-").map((value) => Number(value));
  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

function getCurrentSwissMatches(state: TournamentState): Match[] {
  return state.matches.filter(
    (match) =>
      match.stage === "swiss" && match.roundIndex === state.currentSwissRound,
  );
}

function getCurrentPlayoffMatches(state: TournamentState): Match[] {
  if (state.stage === "semifinals") {
    return state.matches.filter((match) => match.stage === "semifinal");
  }

  if (state.stage === "final") {
    return state.matches.filter((match) => match.stage === "final");
  }

  return [];
}

function buildSwissColumns(state: TournamentState): SwissColumn[] {
  const swissMatches = state.matches.filter((match) => match.stage === "swiss");
  const matchGroups = new Map<string, Match[]>();
  const standingsGroups = new Map<string, Team[]>();
  const editableLabels = new Set<string>();

  for (const match of swissMatches) {
    if (!matchGroups.has(match.bracketLabel)) {
      matchGroups.set(match.bracketLabel, []);
    }
    matchGroups.get(match.bracketLabel)?.push(match);

    if (match.roundIndex === state.currentSwissRound) {
      editableLabels.add(match.bracketLabel);
    }
  }

  for (const team of state.teams) {
    const label = `${team.wins}-${team.losses}`;
    if (!standingsGroups.has(label)) {
      standingsGroups.set(label, []);
    }
    standingsGroups.get(label)?.push(team);
  }

  const maxDepth = Math.max(
    state.currentSwissRound,
    ...state.teams.map((team) => team.wins + team.losses),
    ...swissMatches.map((match) => {
      const record = parseRecordLabel(match.bracketLabel);
      return record.wins + record.losses;
    }),
    0,
  );

  return Array.from({ length: maxDepth + 1 }, (_, depth) => ({
    depth,
    boxes: Array.from({ length: depth + 1 }, (_, rowIndex) => {
      const wins = depth - rowIndex;
      const losses = rowIndex;
      const label = `${wins}-${losses}`;
      const matches = matchGroups.get(label) ?? [];
      return {
        label,
        matches,
        revealedMatches: matches.filter((match) => match.revealed),
        hiddenMatches: matches.filter((match) => !match.revealed),
        teams: standingsGroups.get(label) ?? [],
        isEditable: editableLabels.has(label),
      };
    }),
  }));
}

function getRegistrationUrl(publicBaseUrl: string, browserOrigin: string): string {
  const baseUrl = normalizeBaseUrlInput(publicBaseUrl) || normalizeBaseUrlInput(browserOrigin);
  return baseUrl ? `${baseUrl}/join` : "";
}

function getAssignedParticipantIds(teams: Team[]): Set<string> {
  return new Set(
    teams.flatMap((team) =>
      team.players
        .map((player) => player.participantId)
        .filter(Boolean) as string[],
    ),
  );
}

function getTeamConfirmationLabel(team: Team): string {
  if (!isTeamComplete(team)) {
    return "pendiente";
  }

  return team.confirmed ? "aceptada" : "sin aceptar";
}

function teamSlotPlayer(team: Team, slot: PlayerSlot) {
  return slot === "A" ? team.players[0] : team.players[1];
}

function stageContinuationScreen(stage: TournamentState["stage"]): Screen {
  if (stage === "swiss") {
    return "swiss";
  }

  if (stage === "semifinals" || stage === "final" || stage === "completed") {
    return "topcut";
  }

  return "registration";
}

function formatTournamentFormatLabel(format: TournamentFormat): string {
  return format === "swiss_only" ? "Suizo solo" : "Suizo + top 4";
}

function describeTournamentPlan(
  teamCount: number,
  format: TournamentFormat,
): {
  heading: string;
  detail: string;
  roundsLabel: string;
} {
  const structure = getTournamentStructure(teamCount, format);

  if (structure.entryStage === "final") {
    return {
      heading: "Final directa",
      detail: "Con 2 parejas el torneo arranca directamente en una final.",
      roundsLabel: "1 fase total",
    };
  }

  if (structure.entryStage === "semifinals") {
    return {
      heading: "Semifinales + final",
      detail:
        teamCount === 3
          ? "Con 3 parejas se monta semifinal directa con bye para la cabeza de serie y luego final."
          : "Con 3 o 4 parejas se juega fase eliminatoria directa con semifinales y final.",
      roundsLabel: "2 fases totales",
    };
  }

  if (format === "swiss_only") {
    return {
      heading: `${structure.swissRounds} rondas suizas`,
      detail:
        "El torneo termina con clasificación final por puntos y desempates, sin semifinales ni final.",
      roundsLabel: `${structure.swissRounds} rondas totales`,
    };
  }

  return {
    heading: `${structure.swissRounds} rondas suizas + top 4`,
    detail:
      "Tras el suizo, los 4 primeros pasan a semifinales y final según la clasificación.",
    roundsLabel: `${structure.totalRounds} fases totales`,
  };
}

function BackButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick} className="button-secondary">
      ← {label}
    </button>
  );
}

function TeamFaces({
  team,
  size = "md",
}: {
  team: Team;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizeClasses = {
    sm: {
      frame: "h-10 w-10 text-[11px]",
      overlap: "translate-x-[-8px]",
      margin: "-ml-2",
    },
    md: {
      frame: "h-12 w-12 text-sm",
      overlap: "translate-x-[-10px]",
      margin: "-ml-[10px]",
    },
    lg: {
      frame: "h-16 w-16 text-base",
      overlap: "translate-x-[-14px]",
      margin: "-ml-[14px]",
    },
    xl: {
      frame: "h-20 w-20 text-lg",
      overlap: "translate-x-[-18px]",
      margin: "-ml-[18px]",
    },
  }[size];

  return (
    <div className="flex items-center">
      {team.players.map((player, index) => (
        <div
          key={`${team.id}-${player.slot}-${player.id}`}
          className={`${sizeClasses.margin} first:ml-0 flex ${sizeClasses.frame} items-center justify-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)] font-semibold text-[var(--foreground)] ${
            index === 1 ? sizeClasses.overlap : ""
          }`}
        >
          {player.photoUrl ? (
            <img
              src={player.photoUrl}
              alt={playerName(team, index)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{index === 0 ? "A" : "B"}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function StageBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex min-h-7 items-center justify-center whitespace-nowrap rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1 text-center font-mono text-[11px] uppercase leading-none tracking-[0.18em] text-[var(--muted)]">
      {label}
    </span>
  );
}

function StepPreviewPlayerRow({
  team,
  index,
}: {
  team: Team;
  index: 0 | 1;
}) {
  const player = team.players[index];

  return (
    <div className="flex items-center gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3">
      <div className="h-14 w-14 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
        {player.photoUrl ? (
          <img
            src={player.photoUrl}
            alt={playerName(team, index)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-semibold text-[var(--muted)]">
            {index === 0 ? "A" : "B"}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
          Integrante {index === 0 ? "A" : "B"}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">
          {playerName(team, index)}
        </p>
      </div>
    </div>
  );
}

function StepPreviewTeamSummary({ team }: { team: Team }) {
  return (
    <>
      <div className="mt-4 grid gap-2">
        <StepPreviewPlayerRow team={team} index={0} />
        <StepPreviewPlayerRow team={team} index={1} />
      </div>
      {!team.nameIsCustom ? null : (
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          Nombre definido desde móvil
        </p>
      )}
    </>
  );
}

function AdminCredit() {
  return (
    <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[rgba(242,247,238,0.42)]">
      Creado por Álvaro García Ortiz
    </p>
  );
}

function FeedbackToast({ feedback }: { feedback: FeedbackState | null }) {
  if (!feedback || feedback.tone !== "error") {
    return null;
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-md rounded-[8px] border border-rose-500/30 bg-rose-500/14 px-4 py-3 text-sm leading-6 text-rose-100 shadow-[0_18px_60px_rgba(0,0,0,0.36)]">
      {feedback.text}
    </div>
  );
}

function ScreenFrame({
  eyebrow,
  title,
  description,
  leftSlot,
  rightSlot,
  activeUrl,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  activeUrl?: string;
  children: ReactNode;
}) {
  const viewportProfile = useViewportProfile();

  return (
    <div className="relative h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.055)_0%,transparent_34%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] opacity-40" />

      <main
        className="admin-shell relative mx-auto flex h-[100svh] w-full max-w-[1920px] flex-col overflow-hidden px-3 py-4 md:px-4 md:py-5 2xl:px-5"
        data-density={viewportProfile.density}
        style={
          {
            "--admin-vw": `${viewportProfile.width}px`,
            "--admin-vh": `${viewportProfile.height}px`,
          } as CSSProperties
        }
      >
        <header className="admin-header grid gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4 shadow-[0_35px_120px_rgba(0,0,0,0.28)] md:grid-cols-[1fr_auto] md:p-4">
          <div className="max-w-4xl">
            {leftSlot ? <div className="mb-2">{leftSlot}</div> : null}
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
              {eyebrow}
            </p>
            <h1 className="mt-2 text-[clamp(2rem,3.2vw,3.65rem)] font-semibold leading-[0.96] tracking-normal text-[var(--foreground)]">
              {title}
            </h1>
            {description ? (
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[var(--muted)] md:text-base">
                {description}
              </p>
            ) : null}
          </div>
          <div className="flex min-h-full flex-col items-end justify-between gap-4 md:justify-self-end">
            {rightSlot ? <div className="flex flex-wrap justify-end gap-2">{rightSlot}</div> : null}
            <div className="max-w-[min(44vw,620px)] text-right">
              {activeUrl ? (
                <p className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-[rgba(242,247,238,0.46)]">
                  URL activa · {activeUrl}
                </p>
              ) : null}
              <AdminCredit />
            </div>
          </div>
        </header>

        <div className="admin-content mt-4 min-h-0 flex-1 overflow-hidden">{children}</div>
      </main>
    </div>
  );
}

function PublicUrlScreen({
  value,
  onChange,
  onSubmit,
  onUseCurrentOrigin,
  canUseCurrentOrigin,
  browserOrigin,
  networkBaseUrls,
  isPending,
  feedback,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUseCurrentOrigin: () => void;
  canUseCurrentOrigin: boolean;
  browserOrigin: string;
  networkBaseUrls: string[];
  isPending: boolean;
  feedback: FeedbackState | null;
}) {
  const suggestedNetworkUrl = networkBaseUrls[0] ?? "";
  const normalizedValue = normalizeBaseUrlInput(value);
  const valueLooksStale =
    Boolean(normalizedValue && suggestedNetworkUrl) &&
    !networkBaseUrls.includes(normalizedValue);

  return (
    <ScreenFrame
      eyebrow="Paso 1 · Acceso"
      title="URL del torneo"
      activeUrl={normalizeBaseUrlInput(value)}
      rightSlot={
        <div className="flex flex-wrap gap-2">
          <StageBadge label="Mesa privada" />
          <StageBadge label="QR general" />
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.72fr)]">
        <form
          onSubmit={onSubmit}
          className="glass-panel rounded-[8px]  p-6 text-[var(--foreground)]"
        >
          <div className="flex items-center gap-2">
            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--muted)]">
              URL base
            </p>
            <InfoHint label="Usa la URL que abrirán los móviles: la dirección Network de Next si están en la misma Wi-Fi, o el dominio/túnel público si juegan desde fuera." />
          </div>
          <label className="mt-6 block">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
              URL del torneo
            </span>
            <input
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="http://192.168.1.41:3000"
              className="input-shell mt-2"
            />
          </label>

          <div className="mt-5 flex flex-wrap gap-3">
            <button type="submit" disabled={isPending} className="button-primary">
              Guardar URL
            </button>
            {canUseCurrentOrigin ? (
              <button type="button" onClick={onUseCurrentOrigin} className="button-secondary">
                Usar {browserOrigin}
              </button>
            ) : null}
            {suggestedNetworkUrl ? (
              <button
                type="button"
                onClick={() => onChange(suggestedNetworkUrl)}
                className="button-secondary"
              >
                Usar Wi-Fi {suggestedNetworkUrl}
              </button>
            ) : null}
          </div>

          {valueLooksStale ? (
            <div className="mt-5 rounded-[8px] border border-amber-400/24 bg-amber-400/10 px-4 py-3 text-sm leading-6 text-amber-100">
              La URL guardada parece de otra red. Para esta Wi-Fi usa{" "}
              <span className="font-mono">{suggestedNetworkUrl}</span>.
            </div>
          ) : null}
        </form>
      </div>
      <FeedbackToast feedback={feedback} />
    </ScreenFrame>
  );
}

function TournamentSetupScreen({
  form,
  planSummary,
  onChange,
  onSubmit,
  onBackToUrl,
  onContinue,
  continueLabel,
  currentStateDetail,
  isPending,
  publicBaseUrl,
  feedback,
}: {
  form: SetupFormState;
  planSummary: {
    heading: string;
    detail: string;
    roundsLabel: string;
  };
  onChange: (patch: Partial<SetupFormState>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBackToUrl?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  currentStateDetail?: string | null;
  isPending: boolean;
  publicBaseUrl: string;
  feedback: FeedbackState | null;
}) {
  return (
    <ScreenFrame
      eyebrow="Paso 2 · Configuración"
      title="Formato"
      activeUrl={publicBaseUrl}
      leftSlot={
        onBackToUrl ? <BackButton label="Volver a la URL" onClick={onBackToUrl} /> : undefined
      }
    >
      <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[0.82fr_1.18fr]">
        <section className="min-h-0 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4">
          <div className="rounded-[8px] border border-[var(--accent-border)] bg-[linear-gradient(180deg,rgba(124,255,79,0.10),rgba(18,24,19,0.98))] p-5">
            <div className="flex items-center gap-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                Estructura calculada
              </p>
              <InfoHint label="Se calcula automáticamente con el número de parejas y el formato elegido." />
            </div>
            <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{planSummary.heading}</h3>
            <div className="mt-4 flex flex-wrap gap-2">
              <StageBadge label={planSummary.roundsLabel} />
              <StageBadge label={formatTournamentFormatLabel(form.format)} />
            </div>
          </div>

          {currentStateDetail ? (
            <div className="mt-4 rounded-[8px] border border-[var(--accent-border)] bg-[linear-gradient(180deg,rgba(124,255,79,0.10),rgba(18,24,19,0.98))] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                Estado actual
              </p>
              <p className="mt-3 text-sm leading-7 text-[var(--muted)]">{currentStateDetail}</p>
              {onContinue && continueLabel ? (
                <div className="mt-5">
                  <button type="button" onClick={onContinue} className="button-secondary">
                    {continueLabel}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </section>

        <form
          onSubmit={onSubmit}
          className="glass-panel min-h-0 rounded-[8px] p-4 text-[var(--foreground)]"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Nombre del torneo
              </span>
              <input
                value={form.title}
                onChange={(event) => onChange({ title: event.target.value })}
                className="input-shell mt-2"
              />
            </label>

            <div className="block md:col-span-2">
              <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Tipo de torneo
                <InfoHint label="Elige suizo solo para terminar por clasificación, o suizo + top 4 para jugar semifinales y final." />
              </span>
              <select
                value={form.format}
                onChange={(event) =>
                  onChange({ format: event.target.value as TournamentFormat })
                }
                className="input-shell mt-2"
              >
                <option value="swiss_top4">Suizo + top 4</option>
                <option value="swiss_only">Suizo solo</option>
              </select>
            </div>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Número de parejas
              </span>
              <input
                type="number"
                min={2}
                step={1}
                value={form.teamCount}
                onChange={(event) => onChange({ teamCount: event.target.value })}
                className="input-shell mt-2"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Vacas por partida
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.vacasPerMatch}
                onChange={(event) => onChange({ vacasPerMatch: event.target.value })}
                className="input-shell mt-2"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Juegos por vaca
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={form.gamesPerVaca}
                onChange={(event) => onChange({ gamesPerVaca: event.target.value })}
                className="input-shell mt-2"
              />
            </label>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Puntos por juego
              </span>
              <input
                type="number"
                min={30}
                max={40}
                step={1}
                value={form.targetPoints}
                onChange={(event) => onChange({ targetPoints: event.target.value })}
                className="input-shell mt-2"
              />
            </label>
          </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <button type="submit" disabled={isPending} className="button-primary">
              Guardar y pasar al registro
            </button>
          </div>

        </form>
      </div>
      <FeedbackToast feedback={feedback} />
    </ScreenFrame>
  );
}

function RegistrationQrCard({
  registrationUrl,
}: {
  registrationUrl: string;
}) {
  const [qrState, setQrState] = useState<{ url: string; dataUrl: string }>({
    url: "",
    dataUrl: "",
  });
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const currentQrDataUrl = qrState.url === registrationUrl ? qrState.dataUrl : "";

  useEffect(() => {
    if (!registrationUrl) {
      return;
    }

    void QRCode.toDataURL(registrationUrl, {
      width: 420,
      margin: 1,
      color: {
        dark: "#10160f",
        light: "#f4f7ef",
      },
    }).then((dataUrl) => {
      setQrState({ url: registrationUrl, dataUrl });
    });
  }, [registrationUrl]);

  useEffect(() => {
    if (!expanded) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setExpanded(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [expanded]);

  async function handleCopy(): Promise<void> {
    if (!registrationUrl) {
      return;
    }

    await navigator.clipboard.writeText(registrationUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <>
    <div className="registration-qr-card rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              QR de inscripción
            </p>
            <InfoHint label="Este QR lo escanean los jugadores para registrarse con nombre y foto desde su móvil." />
          </div>
          <h3 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
            Un solo QR para todos los jugadores
          </h3>
        </div>
        <button type="button" onClick={() => void handleCopy()} className="button-secondary">
          {copied ? "Copiado" : "Copiar enlace"}
        </button>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-[150px_1fr]">
        <button
          type="button"
          onClick={() => currentQrDataUrl && setExpanded(true)}
          className="rounded-[8px] border border-[var(--stroke)] bg-[#f4f7ef] p-2 transition hover:border-[var(--accent-border)]"
          aria-label="Ampliar QR de inscripción"
        >
          {currentQrDataUrl ? (
            <img
              src={currentQrDataUrl}
              alt="QR de inscripción"
              className="aspect-square w-full rounded-[8px] object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[8px] border border-dashed border-[#c9d2c2] text-sm text-[var(--muted-soft)]">
              Generando QR...
            </div>
          )}
        </button>

        <div className="space-y-4">
          <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Enlace activo
            </p>
            <p className="mt-2 break-all font-mono text-xs leading-5 text-[var(--muted)]">
              {registrationUrl || "Guarda primero la URL activa del torneo."}
            </p>
          </div>
        </div>
      </div>
    </div>
    {expanded && currentQrDataUrl ? (
      <button
        type="button"
        className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-[rgba(2,4,3,0.9)] p-8 backdrop-blur-sm"
        onClick={() => setExpanded(false)}
        aria-label="Cerrar QR ampliado"
      >
        <span className="w-full max-w-[min(78vh,720px)] rounded-[12px] border border-[var(--accent-border)] bg-[#f4f7ef] p-5 shadow-[0_30px_140px_rgba(0,0,0,0.55)]">
          <img
            src={currentQrDataUrl}
            alt="QR de inscripción ampliado"
            className="aspect-square w-full rounded-[8px] object-cover"
          />
        </span>
      </button>
    ) : null}
    </>
  );
}

function ParticipantCard({
  participant,
  draggable = false,
  dimmed = false,
  onDragStart,
  onDragEnd,
  canEdit = false,
  onEdit,
}: {
  participant: Participant;
  draggable?: boolean;
  dimmed?: boolean;
  onDragStart?: (participantId: string) => void;
  onDragEnd?: () => void;
  canEdit?: boolean;
  onEdit?: (participant: Participant) => void;
}) {
  const isBot = participant.deviceId.startsWith("bot-");

  return (
    <div
      draggable={draggable}
      onClick={() => {
        if (!canEdit) {
          return;
        }

        onEdit?.(participant);
      }}
      onDragStart={(event) => {
        if (!draggable) {
          return;
        }
        event.dataTransfer.setData("text/participantId", participant.id);
        onDragStart?.(participant.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-3 transition ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${canEdit ? "cursor-pointer hover:border-[var(--accent-border)]" : ""} ${dimmed ? "opacity-45" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
            <img
              src={participant.photoUrl}
              alt={participant.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{participant.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-[10px] text-[var(--muted-soft)]">
                alta {formatSyncTime(participant.registeredAt)}
              </p>
              {isBot ? (
                <span className="rounded-full border border-[var(--stroke)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  bot
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}

function ManualTeamSlotButton({
  team,
  slot,
  onOpen,
}: {
  team: Team;
  slot: PlayerSlot;
  onOpen: (teamId: string, slot: PlayerSlot) => void;
}) {
  const player = teamSlotPlayer(team, slot);
  const filled = Boolean(player.participantId);

  return (
    <button
      type="button"
      onClick={() => onOpen(team.id, slot)}
      className={`rounded-[8px] border border-dashed p-3 ${
        filled ? "border-[var(--stroke)] bg-[var(--surface)]" : "border-[var(--accent-border)] bg-[var(--surface-strong)]"
      }`}
    >
      {filled ? (
        <div className="flex items-center gap-3 text-left">
          <div className="h-12 w-12 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
            {player.photoUrl ? (
              <img
                src={player.photoUrl}
                alt={player.name}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--foreground)]">{player.name}</p>
            <p className="mt-1 text-xs text-[var(--muted-soft)]">Plaza {slot}</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-14 items-center justify-center text-center text-sm leading-6 text-[var(--muted-soft)]">
          Pulsa para elegir a la persona {slot}
        </div>
      )}
    </button>
  );
}

function RegistrationStageScreen({
  state,
  registrationUrl,
  onBack,
  onAddBotParticipant,
  onRenameParticipant,
  onDeleteBotParticipant,
  renamingParticipantId,
  deletingParticipantId,
  onCreateRandomTeams,
  onPrepareManualTeams,
  onAssignParticipant,
  onConfirmManualTeam,
  onStartTournament,
  isPending,
  feedback,
}: {
  state: TournamentState;
  registrationUrl: string;
  onBack: () => void;
  onAddBotParticipant: () => void;
  onRenameParticipant: (participantId: string, name: string) => void;
  onDeleteBotParticipant: (participantId: string) => void;
  renamingParticipantId: string | null;
  deletingParticipantId: string | null;
  onCreateRandomTeams: () => void;
  onPrepareManualTeams: () => void;
  onAssignParticipant: (
    teamId: string,
    slot: PlayerSlot,
    participantId: string | null,
  ) => void;
  onConfirmManualTeam: (teamId: string) => void;
  onStartTournament: () => void;
  isPending: boolean;
  feedback: FeedbackState | null;
}) {
  const structure = getTournamentStructure(state.config.teamCount, state.config.format);
  const expectedParticipants = state.config.teamCount * 2;
  const registeredCount = state.participants.length;
  const remainingCount = Math.max(0, expectedParticipants - registeredCount);
  const participantCountIsEven = registeredCount % 2 === 0;
  const registrationComplete = registeredCount === expectedParticipants;
  const canCreateTeams = registrationComplete && participantCountIsEven;
  const teamsReady =
    state.teams.length === state.config.teamCount &&
    state.teams.every((team) => isTeamComplete(team) && team.confirmed);
  const assignedParticipantIds = useMemo(
    () => getAssignedParticipantIds(state.teams),
    [state.teams],
  );
  const [manualPicker, setManualPicker] = useState<{
    teamId: string;
    slot: PlayerSlot;
  } | null>(null);
  const pickerTeam = manualPicker
    ? state.teams.find((team) => team.id === manualPicker.teamId) ?? null
    : null;
  const pickerPlayer = pickerTeam && manualPicker
    ? teamSlotPlayer(pickerTeam, manualPicker.slot)
    : null;
  const pickerOptions = useMemo(() => {
    if (!manualPicker) {
      return [];
    }

    const currentParticipantId = pickerPlayer?.participantId ?? null;

    return state.participants
      .filter(
        (participant) =>
          !assignedParticipantIds.has(participant.id) ||
          participant.id === currentParticipantId,
      )
      .toSorted((left, right) => left.name.localeCompare(right.name, "es"));
  }, [assignedParticipantIds, manualPicker, pickerPlayer?.participantId, state.participants]);
  const activeManualPicker =
    state.teamCreationMode === "manual" && pickerTeam ? manualPicker : null;
  const startTimerRef = useRef<number | null>(null);
  const [launchFxVisible, setLaunchFxVisible] = useState(false);
  const [editingBotId, setEditingBotId] = useState<string | null>(null);
  const [editingBotName, setEditingBotName] = useState("");
  const activeEditingBot = editingBotId
    ? state.participants.find((participant) => participant.id === editingBotId) ?? null
    : null;

  useEffect(() => {
    if (!editingBotId) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setEditingBotId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingBotId]);

  function openBotEditor(participant: Participant): void {
    setEditingBotId(participant.id);
    setEditingBotName(participant.name);
  }

  useEffect(() => {
    if (!launchFxVisible) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLaunchFxVisible(false);
    }, 920);

    return () => window.clearTimeout(timeoutId);
  }, [launchFxVisible]);

  useEffect(() => {
    return () => {
      if (startTimerRef.current !== null) {
        window.clearTimeout(startTimerRef.current);
      }
    };
  }, []);

  function handleLaunchTournament(): void {
    if (isPending || !teamsReady) {
      return;
    }

    setLaunchFxVisible(true);

    if (startTimerRef.current !== null) {
      window.clearTimeout(startTimerRef.current);
    }

    startTimerRef.current = window.setTimeout(() => {
      startTimerRef.current = null;
      onStartTournament();
    }, 180);
  }

  return (
    <>
      <ScreenFrame
        eyebrow="Paso 3 · Registro y parejas"
        title="Registro y parejas"
        activeUrl={state.config.publicBaseUrl}
        leftSlot={<BackButton label="Volver a configuración" onClick={onBack} />}
        rightSlot={
          <div className="flex flex-wrap gap-2">
            <StageBadge label={`${registeredCount}/${expectedParticipants} personas`} />
            <StageBadge label={`${state.config.teamCount} parejas`} />
            <StageBadge label={state.teamCreationMode === "pending" ? "sin parejas" : state.teamCreationMode === "random" ? "modo aleatorio" : "modo manual"} />
          </div>
        }
      >
        <div className="registration-dashboard grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3">
          <section
            className={`launch-panel ${teamsReady ? "launch-panel-ready" : "launch-panel-blocked"} ${
              launchFxVisible ? "launch-panel-firing" : ""
            }`}
          >
            <div className="launch-panel-orb launch-panel-orb-left" />
            <div className="launch-panel-orb launch-panel-orb-right" />
            <div className="relative z-10 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <div className="flex items-center gap-2">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]">
                    Lanzamiento del torneo
                  </p>
                  <InfoHint label="El botón se activa cuando todas las parejas están completas." />
                </div>
                <h2 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--foreground)] md:text-3xl">
                  {teamsReady
                    ? "Todo está listo para abrir la primera fase."
                    : "Cierra primero todas las parejas para poder arrancar."}
                </h2>

                <div className="mt-3 flex flex-wrap gap-2">
                  <StageBadge
                    label={`${state.teams.filter((team) => isTeamComplete(team) && team.confirmed).length}/${state.config.teamCount} parejas aceptadas`}
                  />
                  <StageBadge
                    label={
                      structure.swissRounds > 0
                        ? `${structure.swissRounds} rondas previas`
                        : structure.entryStage === "final"
                          ? "entrada a final"
                          : "entrada a semis"
                    }
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={handleLaunchTournament}
                disabled={isPending || !teamsReady}
                className={`launch-button ${launchFxVisible ? "launch-button-firing" : ""}`}
              >
                <span className="launch-button-core" />
                <span className="relative z-10 flex flex-col items-center">
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                    {isPending ? "Preparando" : "Acción principal"}
                  </span>
                  <span className="mt-1 text-lg font-semibold tracking-[0.02em] text-[var(--foreground)]">
                    {isPending ? "Montando cuadro..." : "Empezar torneo"}
                  </span>
                </span>
              </button>
            </div>
          </section>

          <div className="grid min-h-0 gap-3 overflow-hidden xl:grid-cols-[minmax(416px,0.57fr)_minmax(0,1.43fr)] 2xl:grid-cols-[minmax(466px,0.52fr)_minmax(0,1.48fr)]">
            <div className="min-h-0 space-y-3 overflow-hidden">
              <RegistrationQrCard registrationUrl={registrationUrl} />

              <section className="registration-status-card rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                      Estado del registro
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                      {registrationComplete
                        ? "Ya están todos los jugadores"
                        : `Faltan ${remainingCount} personas por entrar`}
                    </h3>
                  </div>
                  <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                    {participantCountIsEven ? "conteo par" : "conteo impar"}
                  </span>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-3">
                  <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-2.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                      Registrados
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{registeredCount}</p>
                  </div>
                  <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-2.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                      Objetivo
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{expectedParticipants}</p>
                  </div>
                  <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-2.5">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                      Parejas listas
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                      {state.teams.filter((team) => isTeamComplete(team) && team.confirmed).length}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={onAddBotParticipant}
                    disabled={isPending || registeredCount >= expectedParticipants}
                    className="button-secondary"
                  >
                    Añadir bot de prueba
                  </button>
                  <button
                    type="button"
                    onClick={onCreateRandomTeams}
                    disabled={isPending || !canCreateTeams}
                    className="button-primary"
                  >
                    Sortear parejas aleatoriamente
                  </button>
                  <button
                    type="button"
                    onClick={onPrepareManualTeams}
                    disabled={isPending || !canCreateTeams}
                    className="button-secondary"
                  >
                    Formar parejas manualmente
                  </button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <StageBadge label={formatTournamentFormatLabel(state.config.format)} />
                  <StageBadge
                    label={
                      structure.swissRounds > 0
                        ? `${structure.swissRounds} rondas suizas`
                        : structure.entryStage === "final"
                          ? "final directa"
                          : "semifinales directas"
                    }
                  />
                </div>

                {!canCreateTeams ? (
                  <div className="mt-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                    {registeredCount === 0
                      ? "Todavía no se ha registrado nadie."
                      : !participantCountIsEven
                        ? "No puedes crear parejas hasta tener un número par de personas."
                        : registeredCount < expectedParticipants
                          ? "Aún no han entrado todas las personas previstas por la configuración del torneo."
                          : "El número de personas registradas no coincide con la configuración del torneo."}
                  </div>
                ) : null}
              </section>
            </div>

            <div className="min-h-0 overflow-hidden">
              {state.teamCreationMode === "pending" ? (
                <section className="flex h-full min-h-0 flex-col rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                        Personas registradas
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                        Van apareciendo en directo
                      </h3>
                    </div>
                    <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                      {registeredCount}/{expectedParticipants}
                    </span>
                  </div>

                  <div className="mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fit,minmax(145px,1fr))] gap-3 overflow-y-auto overflow-x-hidden pr-2">
                    {state.participants.map((participant) => (
                      <ParticipantCard
                        key={participant.id}
                        participant={participant}
                        dimmed={assignedParticipantIds.has(participant.id)}
                        canEdit={participant.deviceId.startsWith("bot-")}
                        onEdit={openBotEditor}
                      />
                    ))}
                    {state.participants.length === 0 ? (
                      <div className="rounded-[8px] border border-dashed border-[var(--stroke)] bg-[var(--surface-strong)] px-5 py-8 text-sm leading-7 text-[var(--muted-soft)] md:col-span-2 2xl:col-span-3">
                        En cuanto los móviles empiecen a escanear el QR, aquí aparecerán sus nombres y fotos.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : (
                <section className="flex h-full min-h-0 flex-col rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                        Parejas resultantes
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                        Vista previa antes de pasar al torneo
                      </h3>
                      {state.teamCreationMode === "manual" ? (
                        <div className="mt-2 flex items-center gap-2">
                          <InfoHint label="Pulsa una plaza libre para elegir una persona disponible." />
                        </div>
                      ) : null}
                    </div>
                    <StageBadge label={`${state.teams.length}/${state.config.teamCount} parejas`} />
                  </div>

                  <div className="mt-4 grid min-h-0 flex-1 auto-rows-min grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3 overflow-y-auto overflow-x-hidden pr-2">
                    {state.teams.map((team) => (
                      <div
                        key={`preview-top-${team.id}`}
                        className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-[var(--foreground)]">
                              {team.nameIsCustom ? team.name : team.label}
                            </p>
                          </div>
                          {state.teamCreationMode === "manual" ? (
                            <span className="rounded-full border border-[var(--stroke)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                              {getTeamConfirmationLabel(team)}
                            </span>
                          ) : null}
                        </div>

                      {state.teamCreationMode === "manual" ? (
                        <div className="mt-4 grid gap-3">
                          <ManualTeamSlotButton
                            team={team}
                              slot="A"
                              onOpen={(teamId, slot) => setManualPicker({ teamId, slot })}
                            />
                            <ManualTeamSlotButton
                              team={team}
                              slot="B"
                              onOpen={(teamId, slot) => setManualPicker({ teamId, slot })}
                            />
                            {isTeamComplete(team) && !team.confirmed ? (
                              <button
                                type="button"
                                onClick={() => onConfirmManualTeam(team.id)}
                                disabled={isPending}
                                className="button-primary w-full"
                              >
                                Aceptar pareja
                              </button>
                            ) : team.confirmed ? (
                              <div className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                                Pareja aceptada
                              </div>
                            ) : null}
                        </div>
                      ) : (
                        <StepPreviewTeamSummary team={team} />
                      )}
                    </div>
                  ))}
                  </div>
                </section>
              )}
            </div>
          </div>

          {state.teams.length > 0 && state.teamCreationMode === "pending" ? (
            <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                    Parejas resultantes
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                    Vista previa antes de pasar al torneo
                  </h3>
                </div>
                <StageBadge label={`${state.teams.length}/${state.config.teamCount} parejas`} />
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {state.teams.map((team) => (
                  <div
                    key={`preview-${team.id}`}
                    className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-[var(--foreground)]">
                          {team.nameIsCustom ? team.name : team.label}
                        </p>
                      </div>
                    </div>
                    <StepPreviewTeamSummary team={team} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}

        </div>
      </ScreenFrame>
      <FeedbackToast feedback={feedback} />

      {activeEditingBot ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm"
          onClick={() => setEditingBotId(null)}
        >
          <form
            className="w-full max-w-md rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.45)]"
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const trimmedName = editingBotName.trim();

              if (!trimmedName) {
                return;
              }

              onRenameParticipant(activeEditingBot.id, trimmedName);
              setEditingBotId(null);
            }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]">
                  Editar bot
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  {activeEditingBot.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingBotId(null)}
                className="button-secondary px-3"
                aria-label="Cerrar edición de bot"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5 flex items-center gap-4 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-3">
              <div className="h-14 w-14 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
                <img
                  src={activeEditingBot.photoUrl}
                  alt={activeEditingBot.name}
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted-soft)]">
                  Bot de prueba
                </p>
                <p className="mt-1 truncate text-sm font-semibold text-[var(--foreground)]">
                  alta {formatSyncTime(activeEditingBot.registeredAt)}
                </p>
              </div>
            </div>

            <label className="mt-5 block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                Nombre visible
              </span>
              <input
                value={editingBotName}
                onChange={(event) => setEditingBotName(event.target.value)}
                className="input-shell mt-2 w-full"
                autoFocus
                maxLength={36}
              />
            </label>

            <div className="mt-5 flex flex-wrap justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  onDeleteBotParticipant(activeEditingBot.id);
                  setEditingBotId(null);
                }}
                disabled={deletingParticipantId === activeEditingBot.id}
                className="button-secondary border-red-500/40 text-red-200 hover:border-red-400/70"
              >
                {deletingParticipantId === activeEditingBot.id ? "Eliminando..." : "Eliminar"}
              </button>
              <button
                type="submit"
                disabled={
                  renamingParticipantId === activeEditingBot.id ||
                  editingBotName.trim().length === 0
                }
                className="button-primary"
              >
                {renamingParticipantId === activeEditingBot.id ? "Guardando..." : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {activeManualPicker && pickerTeam ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
                    Selección manual
                  </p>
                  <InfoHint label="Elige una persona libre para esta plaza o libera la plaza actual." />
                </div>
                <h3 className="mt-2 text-3xl font-semibold tracking-normal text-[var(--foreground)]">
                  {pickerTeam.label} · plaza {activeManualPicker.slot}
                </h3>
              </div>

              <div className="flex flex-wrap gap-2">
                <StageBadge
                  label={`${pickerOptions.filter((participant) => participant.id !== pickerPlayer?.participantId).length} libres`}
                />
                <button
                  type="button"
                  onClick={() => setManualPicker(null)}
                  className="button-secondary"
                >
                  Cerrar
                </button>
              </div>
            </div>

            {pickerPlayer?.participantId ? (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-soft)]">
                    Plaza actual
                  </p>
                  <p className="mt-1 text-base font-semibold text-[var(--foreground)]">{pickerPlayer.name}</p>
                </div>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    onAssignParticipant(pickerTeam.id, activeManualPicker.slot, null);
                    setManualPicker(null);
                  }}
                  className="button-secondary"
                >
                  Liberar plaza
                </button>
              </div>
            ) : null}

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {pickerOptions.map((participant) => {
                const isCurrent = participant.id === pickerPlayer?.participantId;
                return (
                  <button
                    key={participant.id}
                    type="button"
                    disabled={isPending}
                    onClick={() => {
                      onAssignParticipant(
                        pickerTeam.id,
                        activeManualPicker.slot,
                        participant.id,
                      );
                      setManualPicker(null);
                    }}
                    className={`rounded-[8px] border p-4 text-left transition ${
                      isCurrent
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                        : "border-[var(--stroke)] bg-[var(--surface-strong)] hover:border-[var(--accent-border)]"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
                        <img
                          src={participant.photoUrl}
                          alt={participant.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-lg font-semibold text-[var(--foreground)]">
                            {participant.name}
                          </p>
                          {participant.deviceId.startsWith("bot-") ? (
                            <span className="rounded-full border border-[var(--stroke)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                              bot
                            </span>
                          ) : null}
                          {isCurrent ? (
                            <span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--accent)]">
                              actual
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-[var(--muted-soft)]">
                          alta {formatSyncTime(participant.registeredAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}

              {pickerOptions.length === 0 ? (
                <div className="rounded-[8px] border border-dashed border-[var(--stroke)] bg-[var(--surface-strong)] px-5 py-8 text-sm leading-7 text-[var(--muted-soft)] md:col-span-2">
                  Ya no quedan personas libres por asignar. Si quieres cambiar esta plaza,
                  primero libera alguna otra o usa la opción de liberar aquí.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function MatchTile({
  match,
  teamsById,
  pointsOnlyMode,
  onOpen,
}: {
  match: Match;
  teamsById: Map<string, Team>;
  pointsOnlyMode: boolean;
  onOpen: (matchId: string) => void;
}) {
  const teamA = match.teamAId ? teamsById.get(match.teamAId) : null;
  const teamB = match.teamBId ? teamsById.get(match.teamBId) : null;
  const scoreA = pointsOnlyMode
    ? match.score?.teamA.points ?? 0
    : match.score?.teamA.vacas ?? 0;
  const scoreB = pointsOnlyMode
    ? match.score?.teamB.points ?? 0
    : match.score?.teamB.vacas ?? 0;

  if (match.bye && teamA) {
    return (
      <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          mesa {match.table}
        </p>
        <div className="mt-3 flex flex-col items-center text-center">
          <TeamFaces team={teamA} size="lg" />
          <p className="mt-4 text-base font-semibold text-[var(--foreground)]">{teamA.name}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
            bye automático
          </p>
        </div>
      </div>
    );
  }

  if (!teamA || !teamB) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(match.id)}
      className="w-full rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-[var(--accent-border)] hover:bg-[var(--surface-raised)]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          mesa {match.table}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
          {match.status === "completed"
            ? `${pointsOnlyMode ? match.score?.teamA.points ?? 0 : match.score?.teamA.vacas ?? 0}-${pointsOnlyMode ? match.score?.teamB.points ?? 0 : match.score?.teamB.vacas ?? 0}`
            : "pendiente"}
        </p>
      </div>

      <div className="mt-4 space-y-3">
        {[
          { team: teamA, side: "left" as const, score: scoreA },
          { team: teamB, side: "right" as const, score: scoreB },
        ].map(({ team, side, score }, index) => (
          <div key={team.id}>
            <div
              className={`grid w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-[8px] px-3 py-2 ${
                side === "left"
                  ? "grid-cols-[minmax(0,1fr)_50px]"
                  : "grid-cols-[50px_minmax(0,1fr)]"
              } ${
                pointsOnlyMode && match.status === "completed"
                  ? match.winnerId === team.id
                    ? "border border-emerald-400/26 bg-emerald-500/10"
                    : match.loserId === team.id
                      ? "border border-rose-400/18 bg-rose-500/8"
                      : ""
                  : ""
              }`}
            >
              {side === "left" ? (
                <>
                  <div className="min-w-0 overflow-hidden text-left">
                    <div className="flex justify-start">
                      <TeamFaces team={team} size="md" />
                    </div>
                    <div className="mt-2 min-w-0">
                      <p
                        className={`break-words text-sm font-semibold leading-5 ${
                          pointsOnlyMode && match.status === "completed" && match.winnerId === team.id
                            ? "text-emerald-200"
                            : pointsOnlyMode &&
                                match.status === "completed" &&
                                match.loserId === team.id
                              ? "text-rose-100"
                              : "text-[var(--foreground)]"
                        }`}
                      >
                        {team.name}
                      </p>
                      <p className="truncate text-[11px] text-[var(--muted-soft)]">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-10 min-w-[50px] flex-none items-center justify-center rounded-[8px] border border-[var(--accent-border)] bg-[var(--background)] px-3 font-mono text-base font-extrabold text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    {score}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-10 min-w-[50px] flex-none items-center justify-center rounded-[8px] border border-[var(--accent-border)] bg-[var(--background)] px-3 font-mono text-base font-extrabold text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    {score}
                  </div>
                  <div className="min-w-0 overflow-hidden text-right">
                    <div className="flex justify-end">
                      <TeamFaces team={team} size="md" />
                    </div>
                    <div className="mt-2 min-w-0">
                      <p
                        className={`break-words text-sm font-semibold leading-5 ${
                          pointsOnlyMode && match.status === "completed" && match.winnerId === team.id
                            ? "text-emerald-200"
                            : pointsOnlyMode &&
                                match.status === "completed" &&
                                match.loserId === team.id
                              ? "text-rose-100"
                              : "text-[var(--foreground)]"
                        }`}
                      >
                        {team.name}
                      </p>
                      <p className="truncate text-[11px] text-[var(--muted-soft)]">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {index === 0 ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-[2px] flex-1 bg-[rgba(244,247,239,0.20)]" />
                <div className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                  vs
                </div>
                <div className="h-[2px] flex-1 bg-[rgba(244,247,239,0.20)]" />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </button>
  );
}

function MatchResultTeamCard({
  match,
  team,
  side,
  sideDraft,
  pointsOnlyMode,
  targetPoints,
  onResultDraftChange,
}: {
  match: Match;
  team: Team;
  side: "teamA" | "teamB";
  sideDraft: ResultDraft["teamA"] | ResultDraft["teamB"];
  pointsOnlyMode: boolean;
  targetPoints: number;
  onResultDraftChange: (
    matchId: string,
    side: "teamA" | "teamB",
    field: "vacas" | "games" | "points",
    value: string,
  ) => void;
}) {
  const scoreFields = pointsOnlyMode
    ? ([["points", `Puntos · máx ${targetPoints}`]] as const)
    : ([
        ["vacas", "Vacas"],
        ["games", "Juegos"],
        ["points", "Puntos"],
      ] as const);

  return (
    <div className="flex h-full min-h-[420px] flex-col justify-between rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5">
      <div className="flex flex-col items-center text-center">
        <TeamFaces team={team} size="xl" />
        <p className="mt-5 text-2xl font-semibold text-[var(--foreground)]">{team.name}</p>
        <p className="mt-2 text-sm text-[var(--muted-soft)]">
          {playerName(team, 0)} · {playerName(team, 1)}
        </p>
        <span className="mt-4 rounded-full border border-[var(--stroke)] px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
          {team.wins}-{team.losses}
        </span>
      </div>

      <div className={`mt-8 ${pointsOnlyMode ? "grid gap-3" : "grid grid-cols-3 gap-3"}`}>
        {scoreFields.map(([field, label]) => (
          <label key={field} className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
              {label}
            </span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              value={sideDraft[field as keyof typeof sideDraft]}
              onChange={(event) =>
                onResultDraftChange(
                  match.id,
                  side,
                  field as "vacas" | "games" | "points",
                  (() => {
                    const digits = event.target.value.replace(/[^\d]/g, "");

                    if (!pointsOnlyMode || digits === "") {
                      return digits;
                    }

                    return String(Math.min(Number(digits), targetPoints));
                  })(),
                )
              }
              maxLength={pointsOnlyMode ? 2 : undefined}
              className="input-shell mt-2 !bg-[var(--surface-inset)] !text-[var(--foreground)] text-center text-xl font-semibold placeholder:!text-[var(--muted-soft)] [appearance:textfield]"
              style={{ WebkitTextFillColor: "var(--foreground)" }}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function SwissStageScreen({
  state,
  resultDrafts,
  onResultDraftChange,
  onSaveMatch,
  onRevealGroup,
  onOpenMatch,
  onCloseMatch,
  activeMatchId,
  onAdvance,
  onSync,
  onBack,
  isPending,
  isSyncing,
  feedback,
}: {
  state: TournamentState;
  resultDrafts: Record<string, ResultDraft>;
  onResultDraftChange: (
    matchId: string,
    side: "teamA" | "teamB",
    field: "vacas" | "games" | "points",
    value: string,
  ) => void;
  onSaveMatch: (match: Match) => void;
  onRevealGroup: (label: string) => void;
  onOpenMatch: (matchId: string) => void;
  onCloseMatch: () => void;
  activeMatchId: string | null;
  onAdvance: () => void;
  onSync: () => void;
  onBack: () => void;
  isPending: boolean;
  isSyncing: boolean;
  feedback: FeedbackState | null;
}) {
  const structure = getTournamentStructure(state.config.teamCount, state.config.format);
  const pointsOnlyMode = isPointsOnlyMatchFormat(state.config);
  const columns = useMemo(() => buildSwissColumns(state), [state]);
  const teamsById = useMemo(
    () => new Map(state.teams.map((team) => [team.id, team])),
    [state.teams],
  );
  const currentRoundMatches = getCurrentSwissMatches(state);
  const hiddenGroupCount = new Set(
    currentRoundMatches
      .filter((match) => !match.revealed)
      .map((match) => match.bracketLabel),
  ).size;
  const allGroupsDrawn =
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.revealed);
  const roundComplete =
    allGroupsDrawn &&
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.status === "completed");
  const pendingMatchesCount = currentRoundMatches.filter(
    (match) => match.status !== "completed",
  ).length;
  const advanceLabel =
    state.currentSwissRound >= state.swissRoundsPlanned
      ? structure.topCut > 0
        ? "Pasar al top 4"
        : "Cerrar clasificación final"
      : "Pasar a la siguiente ronda";
  const activeMatch = activeMatchId
    ? currentRoundMatches.find((match) => match.id === activeMatchId) ??
      state.matches.find((match) => match.id === activeMatchId) ??
      null
    : null;
  const activeTeams = activeMatch
    ? {
        teamA: activeMatch.teamAId ? teamsById.get(activeMatch.teamAId) ?? null : null,
        teamB: activeMatch.teamBId ? teamsById.get(activeMatch.teamBId) ?? null : null,
      }
    : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.05)_0%,transparent_30%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {columns.map((column) => (
          <div
            key={`ghost-${column.depth}`}
            className="absolute top-8 text-[28rem] font-black leading-none tracking-normal text-[rgba(124,255,79,0.06)]"
            style={{ left: `${column.depth * 18 + 1}rem` }}
          >
            {column.depth}
          </div>
        ))}
      </div>

      <main className="relative mx-auto flex h-full max-w-[1880px] flex-col overflow-hidden px-4 py-4 md:px-6 md:py-5">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <BackButton label="Volver al registro" onClick={onBack} />
            <div className="mt-3 flex items-center gap-2">
              <p className="font-mono text-xs uppercase tracking-[0.28em] text-[var(--accent)]">
                Paso 4 · Swiss Stage
              </p>
              <InfoHint label="Sortea cada tramo y abre solo la mesa que quieras cerrar." />
            </div>
            <h1 className="mt-1 text-[clamp(2.8rem,6vw,6.5rem)] font-black leading-[0.9] tracking-normal text-[var(--foreground)]">
              SWISS STAGE
            </h1>
          </div>

          <div className="flex min-h-full flex-col items-end justify-between gap-4 text-right">
            <div className="flex flex-wrap justify-end gap-2">
              <StageBadge label={`Ronda ${state.currentSwissRound}`} />
              <StageBadge label={`Sync ${formatSyncTime(state.updatedAt)}`} />
              <StageBadge label={state.config.title} />
            </div>
            <div className="max-w-[min(44vw,620px)]">
              <p className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-[rgba(242,247,238,0.46)]">
                URL activa · {state.config.publicBaseUrl || "sin definir"}
              </p>
              <AdminCredit />
            </div>
          </div>
        </header>

        <section className="mt-3 flex flex-wrap items-center gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">
            Estado de la ronda
          </span>
          <div className="h-px w-8 bg-[rgba(244,247,239,0.12)]" />
          <p className="text-sm text-[var(--muted)] md:text-base">
            Quedan{" "}
            <span className="font-semibold text-[var(--foreground)]">{pendingMatchesCount}</span>{" "}
            enfrentamientos por cerrar en esta fase.
          </p>
        </section>

        <section className="mt-4 min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-w-0 gap-4 overflow-hidden pr-2">
            {columns.map((column) => (
              <div key={column.depth} className="flex h-full w-[clamp(210px,16vw,300px)] flex-none flex-col">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted-soft)]">
                    tramo {column.depth}
                  </p>
                  <div className="h-px flex-1 bg-[rgba(244,247,239,0.10)]" />
                </div>

                <div className="min-h-0 flex-1 space-y-3 overflow-hidden">
                  {column.boxes.map((box) => {
                    const hasContent = box.matches.length > 0 || box.teams.length > 0;
                    const shouldShowDrawButton =
                      box.isEditable &&
                      box.hiddenMatches.length > 0 &&
                      box.revealedMatches.length === 0;

                    return (
                      <div
                        key={box.label}
                        className={`relative overflow-hidden rounded-[8px] border ${
                          box.isEditable
                            ? "border-[var(--accent)] shadow-[0_18px_48px_rgba(124,255,79,0.14)]"
                            : "border-[var(--stroke)]"
                        } ${hasContent ? "bg-[var(--surface-inset)]" : "bg-[rgba(11,16,12,0.72)]"}`}
                      >
                        <div
                          className={`flex items-center justify-between border-b px-4 py-3 ${
                            box.isEditable
                              ? "border-[var(--accent-border)] bg-[linear-gradient(90deg,#7cff4f,#a6ff82)] text-[var(--accent-ink)]"
                              : "border-[var(--stroke)] bg-[#f4f7ef] text-[var(--background)]"
                          }`}
                        >
                          <span className="font-mono text-lg font-semibold tracking-[0.12em]">
                            {box.label}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                            {shouldShowDrawButton
                              ? "por sortear"
                              : box.revealedMatches.length > 0
                                ? "mesas"
                                : box.teams.length
                                  ? "estado"
                                  : "vacío"}
                          </span>
                        </div>

                        <div className="min-h-[clamp(120px,18vh,220px)] p-3">
                          {box.revealedMatches.length > 0 ? (
                            <div className="space-y-2">
                              {box.revealedMatches.map((match) => (
                                <MatchTile
                                  key={match.id}
                                  match={match}
                                  teamsById={teamsById}
                                  pointsOnlyMode={pointsOnlyMode}
                                  onOpen={onOpenMatch}
                                />
                              ))}
                            </div>
                          ) : box.teams.length > 0 ? (
                            <div className="space-y-2">
                              {box.teams.map((team, index) => (
                                <div
                                  key={team.id}
                                  className="stagger-rise flex items-center justify-between gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3"
                                  style={{ animationDelay: `${index * 70}ms` }}
                                >
                                  <div className="flex min-w-0 items-center gap-4">
                                    <TeamFaces team={team} size="md" />
                                    <div className="min-w-0">
                                      <p className="truncate text-base font-semibold text-[var(--foreground)]">
                                        {team.name}
                                      </p>
                                      <p className="truncate text-[11px] text-[var(--muted-soft)]">
                                        {playerName(team, 0)} · {playerName(team, 1)}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                                    {team.wins}-{team.losses}
                                  </span>
                                </div>
                              ))}

                              {shouldShowDrawButton ? (
                                <button
                                  type="button"
                                  onClick={() => onRevealGroup(box.label)}
                                  className="button-primary mt-2 w-full"
                                >
                                  Sortear tramo {box.label}
                                </button>
                              ) : null}
                            </div>
                          ) : (
                            <div className="flex min-h-[clamp(100px,15vh,180px)] items-center justify-center text-center text-sm leading-6 text-[var(--muted-soft)]">
                              Caja preparada para este balance.
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </section>

        <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.86)] px-4 py-3">
          <div className="flex flex-wrap gap-2">
            <StageBadge label={`${currentRoundMatches.length} enfrentamientos`} />
            <StageBadge
              label={
                hiddenGroupCount > 0
                  ? `${hiddenGroupCount} tramos por sortear`
                  : roundComplete
                    ? "ronda cerrada"
                    : "faltan resultados"
              }
            />
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onSync} disabled={isSyncing} className="button-secondary">
              {isSyncing ? "Sincronizando" : "Sincronizar"}
            </button>
            <button
              type="button"
              onClick={onAdvance}
              disabled={isPending || !roundComplete}
              className="button-primary"
            >
              {advanceLabel}
            </button>
          </div>
        </footer>
      </main>
      <FeedbackToast feedback={feedback} />

      {activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
                    Mesa activa
                  </p>
                  <InfoHint label="Introduce el marcador de cada pareja y guarda el resultado de esta mesa." />
                </div>
                <h2 className="mt-2 text-4xl font-semibold tracking-normal text-[var(--foreground)]">
                  {activeMatch.bracketLabel} · mesa {activeMatch.table}
                </h2>
              </div>
              <button type="button" onClick={onCloseMatch} className="button-secondary">
                Cerrar
              </button>
            </div>

            <article className="mt-6 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] lg:items-stretch">
                <MatchResultTeamCard
                  match={activeMatch}
                  team={activeTeams.teamA}
                  side="teamA"
                  sideDraft={(resultDrafts[activeMatch.id] ?? buildResultDraft(activeMatch)).teamA}
                  pointsOnlyMode={pointsOnlyMode}
                  targetPoints={state.config.targetPoints}
                  onResultDraftChange={onResultDraftChange}
                />

                <div className="flex items-center justify-center">
                  <div className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-6 py-5 text-center font-mono text-sm uppercase tracking-[0.22em] text-[var(--muted-soft)]">
                    vs
                  </div>
                </div>

                <MatchResultTeamCard
                  match={activeMatch}
                  team={activeTeams.teamB}
                  side="teamB"
                  sideDraft={(resultDrafts[activeMatch.id] ?? buildResultDraft(activeMatch)).teamB}
                  pointsOnlyMode={pointsOnlyMode}
                  targetPoints={state.config.targetPoints}
                  onResultDraftChange={onResultDraftChange}
                />
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => onSaveMatch(activeMatch)}
                  disabled={isPending}
                  className="button-primary"
                >
                  Guardar resultado
                </button>
              </div>
            </article>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function PlayoffStageScreen({
  state,
  resultDrafts,
  onResultDraftChange,
  onSaveMatch,
  onOpenMatch,
  onCloseMatch,
  activeMatchId,
  onAdvance,
  onSync,
  onBack,
  isPending,
  isSyncing,
  feedback,
}: {
  state: TournamentState;
  resultDrafts: Record<string, ResultDraft>;
  onResultDraftChange: (
    matchId: string,
    side: "teamA" | "teamB",
    field: "vacas" | "games" | "points",
    value: string,
  ) => void;
  onSaveMatch: (match: Match) => void;
  onOpenMatch: (matchId: string) => void;
  onCloseMatch: () => void;
  activeMatchId: string | null;
  onAdvance: () => void;
  onSync: () => void;
  onBack: () => void;
  isPending: boolean;
  isSyncing: boolean;
  feedback: FeedbackState | null;
}) {
  const pointsOnlyMode = isPointsOnlyMatchFormat(state.config);
  const teamsById = useMemo(
    () => new Map(state.teams.map((team) => [team.id, team])),
    [state.teams],
  );
  const currentMatches = getCurrentPlayoffMatches(state);
  const roundComplete =
    currentMatches.length > 0 &&
    currentMatches.every((match) => match.status === "completed");
  const pendingMatchesCount = currentMatches.filter(
    (match) => match.status !== "completed",
  ).length;
  const activeMatch = activeMatchId
    ? currentMatches.find((match) => match.id === activeMatchId) ??
      state.matches.find((match) => match.id === activeMatchId) ??
      null
    : null;
  const activeTeams = activeMatch
    ? {
        teamA: activeMatch.teamAId ? teamsById.get(activeMatch.teamAId) ?? null : null,
        teamB: activeMatch.teamBId ? teamsById.get(activeMatch.teamBId) ?? null : null,
      }
    : null;
  const isSemifinals = state.stage === "semifinals";
  const title = isSemifinals ? "SEMIFINALES" : "FINAL";
  const advanceLabel = isSemifinals ? "Pasar a la final" : "Cerrar torneo";

  return (
    <ScreenFrame
      eyebrow={isSemifinals ? "Fase final · Semifinales" : "Fase final · Final"}
      title={title}
      activeUrl={state.config.publicBaseUrl}
      leftSlot={<BackButton label="Volver a configuración" onClick={onBack} />}
      rightSlot={
        <div className="flex flex-wrap gap-2">
          <StageBadge label={formatTournamentFormatLabel(state.config.format)} />
          <StageBadge label={`Sync ${formatSyncTime(state.updatedAt)}`} />
          <StageBadge label={state.config.title} />
        </div>
      }
    >
      <div className="space-y-6">
        <section className="flex flex-wrap items-center gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">
            Estado de la fase
          </span>
          <div className="h-px w-8 bg-[rgba(244,247,239,0.12)]" />
          <p className="text-sm text-[var(--muted)] md:text-base">
            Quedan{" "}
            <span className="font-semibold text-[var(--foreground)]">{pendingMatchesCount}</span>{" "}
            enfrentamientos por cerrar.
          </p>
        </section>

        <section className="grid gap-5 xl:grid-cols-2">
          {currentMatches.map((match) => (
            <MatchTile
              key={match.id}
              match={match}
              teamsById={teamsById}
              pointsOnlyMode={pointsOnlyMode}
              onOpen={onOpenMatch}
            />
          ))}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.82)] px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <StageBadge label={`${currentMatches.length} enfrentamientos`} />
            <StageBadge label={roundComplete ? "fase cerrada" : "faltan resultados"} />
          </div>

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={onSync} disabled={isSyncing} className="button-secondary">
              {isSyncing ? "Sincronizando" : "Sincronizar"}
            </button>
            <button
              type="button"
              onClick={onAdvance}
              disabled={isPending || !roundComplete}
              className="button-primary"
            >
              {advanceLabel}
            </button>
          </div>
        </footer>
      </div>

      {activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
                    Mesa activa
                  </p>
                  <InfoHint label="Introduce el marcador de cada pareja y guarda el resultado de esta mesa." />
                </div>
                <h2 className="mt-2 text-4xl font-semibold tracking-normal text-[var(--foreground)]">
                  {activeMatch.bracketLabel}
                </h2>
              </div>
              <button type="button" onClick={onCloseMatch} className="button-secondary">
                Cerrar
              </button>
            </div>

            <article className="mt-6 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] lg:items-stretch">
                <MatchResultTeamCard
                  match={activeMatch}
                  team={activeTeams.teamA}
                  side="teamA"
                  sideDraft={(resultDrafts[activeMatch.id] ?? buildResultDraft(activeMatch)).teamA}
                  pointsOnlyMode={pointsOnlyMode}
                  targetPoints={state.config.targetPoints}
                  onResultDraftChange={onResultDraftChange}
                />

                <div className="flex items-center justify-center">
                  <div className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-6 py-5 text-center font-mono text-sm uppercase tracking-[0.22em] text-[var(--muted-soft)]">
                    vs
                  </div>
                </div>

                <MatchResultTeamCard
                  match={activeMatch}
                  team={activeTeams.teamB}
                  side="teamB"
                  sideDraft={(resultDrafts[activeMatch.id] ?? buildResultDraft(activeMatch)).teamB}
                  pointsOnlyMode={pointsOnlyMode}
                  targetPoints={state.config.targetPoints}
                  onResultDraftChange={onResultDraftChange}
                />
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  type="button"
                  onClick={() => onSaveMatch(activeMatch)}
                  disabled={isPending}
                  className="button-primary"
                >
                  Guardar resultado
                </button>
              </div>
            </article>
          </div>
        </div>
      ) : null}
      <FeedbackToast feedback={feedback} />
    </ScreenFrame>
  );
}

function CompletedTournamentScreen({
  state,
  onBack,
}: {
  state: TournamentState;
  onBack: () => void;
}) {
  const structure = getTournamentStructure(state.config.teamCount, state.config.format);
  const isSwissClassificationEnd =
    structure.entryStage === "swiss" && state.config.format === "swiss_only";
  const title = isSwissClassificationEnd ? "Clasificación Final" : "Torneo Cerrado";

  return (
    <ScreenFrame
      eyebrow="Resumen final"
      title={title}
      activeUrl={state.config.publicBaseUrl}
      leftSlot={<BackButton label="Volver a configuración" onClick={onBack} />}
      rightSlot={
        <div className="flex flex-wrap gap-2">
          <StageBadge label={formatTournamentFormatLabel(state.config.format)} />
          <StageBadge label={state.config.title} />
        </div>
      }
    >
      <div className="space-y-6">
        {state.championTeamId ? (
          <section className="grid gap-4 md:grid-cols-2">
            {[state.championTeamId, state.runnerUpTeamId]
              .filter(Boolean)
              .map((teamId, index) => {
                const team = state.teams.find((entry) => entry.id === teamId);

                if (!team) {
                  return null;
                }

                return (
                <div
                  key={team.id}
                  className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                    {index === 0 ? "campeón" : "subcampeón"}
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <TeamFaces team={team} />
                    <div>
                      <p className="text-xl font-semibold text-[var(--foreground)]">{team.name}</p>
                      <p className="text-sm text-[var(--muted-soft)]">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </div>
                );
              })}
          </section>
        ) : null}

        <section className="overflow-x-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)]">
          <div className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px] gap-3 border-b border-[var(--stroke)] bg-[var(--surface-strong)] px-5 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
            <span>Puesto</span>
            <span>Equipo</span>
            <span>Balance</span>
            <span>Buchholz</span>
            <span>Vacas</span>
            <span>Juegos</span>
            <span>Puntos</span>
          </div>

          <div className="divide-y divide-[var(--stroke)]">
            {state.teams.map((team, index) => (
              <div
                key={team.id}
                className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px] gap-3 px-5 py-4"
              >
                <div className="text-lg font-semibold text-[var(--foreground)]">{index + 1}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <TeamFaces team={team} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-[var(--foreground)]">{team.name}</p>
                      <p className="truncate text-sm text-[var(--muted-soft)]">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-[var(--foreground)]">
                  {team.wins}-{team.losses}
                </div>
                <div className="text-sm text-[var(--muted)]">{team.buchholz}</div>
                <div className="text-sm text-[var(--muted)]">{team.vacasWon}</div>
                <div className="text-sm text-[var(--muted)]">{team.gamesWon}</div>
                <div className="text-sm text-[var(--muted)]">{team.pointsWon}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ScreenFrame>
  );
}

export function TournamentFlow({
  initialState,
  networkBaseUrls = [],
}: TournamentFlowProps) {
  const [state, setState] = useState(initialState);
  const [forcedScreen, setForcedScreen] = useState<Screen | null>(null);
  const [setupForm, setSetupForm] = useState<SetupFormState>(() =>
    buildSetupForm(initialState),
  );
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [renamingParticipantId, setRenamingParticipantId] = useState<string | null>(null);
  const [deletingParticipantId, setDeletingParticipantId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isPending, startTransition] = useTransition();
  const browserOrigin = useSyncExternalStore(
    subscribeToNothing,
    getBrowserOriginSnapshot,
    () => "",
  );

  const canUseCurrentOrigin = Boolean(browserOrigin) && !isLocalhostLike(browserOrigin);
  const needsPublicUrlGate = !normalizeBaseUrlInput(state.config.publicBaseUrl);
  const registrationUrl = getRegistrationUrl(state.config.publicBaseUrl, browserOrigin);
  const hasExistingProgress =
    state.participants.length > 0 ||
    state.teams.length > 0 ||
    state.matches.length > 0 ||
    state.stage !== "setup";
  const plannedTeamCount = Math.max(2, toNumber(setupForm.teamCount) || state.config.teamCount);
  const planSummary = useMemo(
    () => describeTournamentPlan(plannedTeamCount, setupForm.format),
    [plannedTeamCount, setupForm.format],
  );

  async function pullTournamentState(silent = false): Promise<void> {
    if (!silent) {
      setIsSyncing(true);
    }

    try {
      const response = await fetch("/api/tournament", {
        cache: "no-store",
      });
      const nextState = (await response.json()) as TournamentState | { error: string };

      if (!response.ok || "error" in nextState) {
        throw new Error(
          "error" in nextState
            ? nextState.error
            : "No se ha podido sincronizar el torneo.",
        );
      }

      setState(nextState);
      setSetupForm((current) => ({
        ...current,
        publicBaseUrl:
          current.publicBaseUrl === state.config.publicBaseUrl
            ? nextState.config.publicBaseUrl
            : current.publicBaseUrl,
      }));
    } catch (error) {
      if (!silent) {
        setFeedback({ tone: "error", text: (error as Error).message });
      }
    } finally {
      if (!silent) {
        setIsSyncing(false);
      }
    }
  }

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void fetch("/api/tournament", { cache: "no-store" })
          .then((response) => response.json())
          .then((payload: TournamentState | { error: string }) => {
            if (!("error" in payload)) {
              setState(payload);
            }
          })
          .catch(() => undefined);
      }
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, []);

  async function postAction(payload: unknown): Promise<TournamentState> {
    const response = await fetch("/api/tournament", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const nextState = (await response.json()) as TournamentState | { error: string };

    if (!response.ok || "error" in nextState) {
      throw new Error("error" in nextState ? nextState.error : "No se ha podido guardar.");
    }

    setState(nextState);
    setSetupForm(buildSetupForm(nextState));
    return nextState;
  }

  function runMutation(
    mutation: () => Promise<TournamentState>,
    successMessage: string,
    onSuccess?: (nextState: TournamentState) => void,
    onFinally?: () => void,
  ): void {
    startTransition(() => {
      void mutation()
        .then((nextState) => {
          void successMessage;
          setFeedback(null);
          onSuccess?.(nextState);
        })
        .catch((error) => {
          setFeedback({ tone: "error", text: (error as Error).message });
        })
        .finally(() => {
          onFinally?.();
        });
    });
  }

  function handleCreateTournament(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (
      hasExistingProgress &&
      !window.confirm(
        "Crear este torneo nuevo borrará el registro actual, las parejas creadas y cualquier emparejamiento en curso. ¿Quieres continuar?",
      )
    ) {
      return;
    }

    runMutation(
      () =>
        postAction({
          action: "reset",
          payload: {
            title: setupForm.title,
            teamCount: toNumber(setupForm.teamCount),
            vacasPerMatch: toNumber(setupForm.vacasPerMatch),
            gamesPerVaca: toNumber(setupForm.gamesPerVaca),
            targetPoints: toNumber(setupForm.targetPoints),
            publicBaseUrl: setupForm.publicBaseUrl,
            format: setupForm.format,
          },
        }),
      "Configuración guardada. Ya puedes pasar al registro de jugadores.",
      () => {
        setForcedScreen("registration");
        setActiveMatchId(null);
      },
    );
  }

  function handleSavePublicBaseUrl(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    handleUpdateActiveUrl();
  }

  function handleUpdateActiveUrl(): void {
    const publicBaseUrl = normalizeBaseUrlInput(setupForm.publicBaseUrl);

    if (!publicBaseUrl) {
      setFeedback({
        tone: "error",
        text: "Introduce la URL que usarán los móviles antes de continuar.",
      });
      return;
    }

    runMutation(
      () =>
        postAction({
          action: "setPublicBaseUrl",
          payload: { publicBaseUrl },
        }),
      "URL guardada. Ya puedes seguir con la configuración.",
      () => {
        setForcedScreen("setup");
      },
    );
  }

  function handleCreateRandomTeams(): void {
    runMutation(
      () => postAction({ action: "createRandomTeams" }),
      "Parejas aleatorias creadas. Revísalas antes de pasar al Swiss Stage.",
    );
  }

  function handleAddBotParticipant(): void {
    runMutation(
      () => postAction({ action: "addBotParticipant" }),
      "Bot añadido al registro para pruebas.",
    );
  }

  function handleRenameParticipant(participantId: string, name: string): void {
    setRenamingParticipantId(participantId);

    runMutation(
      () =>
        postAction({
          action: "renameParticipantDuringSetup",
          payload: { participantId, name },
        }),
      "Nombre del bot actualizado.",
      undefined,
      () => {
        setRenamingParticipantId(null);
      },
    );
  }

  function handleDeleteBotParticipant(participantId: string): void {
    setDeletingParticipantId(participantId);

    runMutation(
      () =>
        postAction({
          action: "deleteBotParticipantDuringSetup",
          payload: { participantId },
        }),
      "Bot eliminado.",
      undefined,
      () => {
        setDeletingParticipantId(null);
      },
    );
  }

  function handlePrepareManualTeams(): void {
    runMutation(
      () => postAction({ action: "prepareManualTeams" }),
      "Modo manual activado. Pulsa cada plaza para elegir a sus dos personas.",
    );
  }

  function handleAssignParticipant(
    teamId: string,
    slot: PlayerSlot,
    participantId: string | null,
  ): void {
    runMutation(
      () =>
        postAction({
          action: "assignParticipantToTeamSlot",
          payload: { teamId, slot, participantId },
        }),
      participantId ? "Persona colocada en la pareja." : "Plaza liberada.",
    );
  }

  function handleConfirmManualTeam(teamId: string): void {
    runMutation(
      () =>
        postAction({
          action: "confirmManualTeam",
          payload: { teamId },
        }),
      "Pareja aceptada.",
    );
  }

  function handleStartTournament(): void {
    const structure = getTournamentStructure(state.config.teamCount, state.config.format);
    const successMessage =
      structure.entryStage === "swiss"
        ? structure.topCut > 0
          ? `Ronda 1 preparada. Se jugarán ${structure.swissRounds} rondas suizas antes del top 4.`
          : `Ronda 1 preparada. El torneo terminará tras ${structure.swissRounds} rondas suizas.`
        : structure.entryStage === "semifinals"
          ? "Semifinales directas preparadas."
          : "Final directa preparada.";

    runMutation(
      () => postAction({ action: "startTournament" }),
      successMessage,
      () => {
        const nextStructure = getTournamentStructure(
          state.config.teamCount,
          state.config.format,
        );
        setForcedScreen(nextStructure.entryStage === "swiss" ? "swiss" : "topcut");
        setActiveMatchId(null);
      },
    );
  }

  function handleAdvanceTournament(): void {
    runMutation(
      () => postAction({ action: "advancePhase" }),
      "Fase actualizada.",
      () => {
        setActiveMatchId(null);
      },
    );
  }

  function handleSaveMatch(match: Match): void {
    const draft = resultDrafts[match.id] ?? buildResultDraft(match);
    const pointsOnlyMode = isPointsOnlyMatchFormat(state.config);
    const payload: MatchScore = {
      teamA: {
        vacas: pointsOnlyMode ? 0 : toNumber(draft.teamA.vacas),
        games: pointsOnlyMode ? 0 : toNumber(draft.teamA.games),
        points: toNumber(draft.teamA.points),
      },
      teamB: {
        vacas: pointsOnlyMode ? 0 : toNumber(draft.teamB.vacas),
        games: pointsOnlyMode ? 0 : toNumber(draft.teamB.games),
        points: toNumber(draft.teamB.points),
      },
    };

    runMutation(
      () =>
        postAction({
          action: "reportMatch",
          payload: {
            matchId: match.id,
            score: payload,
          },
        }),
      "Resultado guardado.",
      () => {
        setActiveMatchId(null);
      },
    );
  }

  function handleRevealSwissGroup(bracketLabel: string): void {
    runMutation(
      () =>
        postAction({
          action: "revealSwissGroup",
          payload: { bracketLabel },
        }),
      `Tramo ${bracketLabel} sorteado.`,
    );
  }

  function handleBackFromSwiss(): void {
    if (
      !window.confirm(
        "Si vuelves al paso 3 se borrarán los emparejamientos y resultados del suizo actual. ¿Continuar?",
      )
    ) {
      return;
    }

    runMutation(
      () => postAction({ action: "returnToSetup" }),
      "Has vuelto al paso de registro y parejas.",
      () => {
        setForcedScreen("registration");
        setActiveMatchId(null);
      },
    );
  }

  const existingStateDetail = useMemo(() => {
    if (state.stage === "setup") {
      if (state.participants.length === 0 && state.teams.length === 0) {
        return null;
      }

      return `${state.participants.length}/${state.config.teamCount * 2} personas registradas. ${
        state.teams.length > 0
          ? `${state.teams.filter((team) => isTeamComplete(team) && team.confirmed).length}/${state.config.teamCount} parejas aceptadas.`
          : "Todavía no hay parejas montadas."
      } Formato: ${formatTournamentFormatLabel(state.config.format)}.`;
    }

    if (state.stage === "swiss") {
      return `Torneo en marcha. Ronda ${state.currentSwissRound} del Swiss Stage. Formato ${formatTournamentFormatLabel(state.config.format)}.`;
    }

    return `Fase actual: ${formatStageLabel(state.stage)}.`;
  }, [state]);

  const continueLabel = useMemo(() => {
    if (!hasExistingProgress || !existingStateDetail) {
      return undefined;
    }

    if (state.stage === "setup") {
      return "Continuar registro y parejas";
    }

    if (state.stage === "swiss") {
      return "Continuar Swiss Stage";
    }

    return "Continuar fase actual";
  }, [existingStateDetail, hasExistingProgress, state.stage]);

  const screen: Screen = forcedScreen
    ? forcedScreen
    : needsPublicUrlGate
      ? "url"
      : "setup";

  if (screen === "url") {
    return (
      <PublicUrlScreen
        value={setupForm.publicBaseUrl}
        onChange={(value) =>
          setSetupForm((current) => ({ ...current, publicBaseUrl: value }))
        }
        onSubmit={handleSavePublicBaseUrl}
        onUseCurrentOrigin={() =>
          setSetupForm((current) => ({
            ...current,
            publicBaseUrl: browserOrigin,
          }))
        }
        canUseCurrentOrigin={canUseCurrentOrigin}
        browserOrigin={browserOrigin}
        networkBaseUrls={networkBaseUrls}
        isPending={isPending}
        feedback={feedback}
      />
    );
  }

  if (screen === "setup") {
    return (
      <TournamentSetupScreen
        form={setupForm}
        planSummary={planSummary}
        onChange={(patch) =>
          setSetupForm((current) => ({
            ...current,
            ...patch,
          }))
        }
        onSubmit={handleCreateTournament}
        onBackToUrl={() => {
          setForcedScreen("url");
          setFeedback(null);
        }}
        onContinue={
          hasExistingProgress
            ? () => {
                setForcedScreen(stageContinuationScreen(state.stage));
                setFeedback(null);
              }
            : undefined
        }
        continueLabel={continueLabel}
        currentStateDetail={existingStateDetail}
        isPending={isPending}
        publicBaseUrl={state.config.publicBaseUrl}
        feedback={feedback}
      />
    );
  }

  if (screen === "registration") {
    return (
      <RegistrationStageScreen
        state={state}
        registrationUrl={registrationUrl}
        onBack={() => {
          setForcedScreen("setup");
          setFeedback(null);
        }}
        onAddBotParticipant={handleAddBotParticipant}
        onRenameParticipant={handleRenameParticipant}
        onDeleteBotParticipant={handleDeleteBotParticipant}
        renamingParticipantId={renamingParticipantId}
        deletingParticipantId={deletingParticipantId}
        onCreateRandomTeams={handleCreateRandomTeams}
        onPrepareManualTeams={handlePrepareManualTeams}
        onAssignParticipant={handleAssignParticipant}
        onConfirmManualTeam={handleConfirmManualTeam}
        onStartTournament={handleStartTournament}
        isPending={isPending}
        feedback={feedback}
      />
    );
  }

  if (screen === "swiss") {
    return (
      <SwissStageScreen
        state={state}
        resultDrafts={resultDrafts}
        onResultDraftChange={(matchId, side, field, value) => {
          const match = state.matches.find((entry) => entry.id === matchId);
          if (!match) {
            return;
          }

          setResultDrafts((current) => ({
            ...current,
            [matchId]: {
              ...(current[matchId] ?? buildResultDraft(match)),
              [side]: {
                ...(current[matchId]?.[side] ?? {
                  vacas: "0",
                  games: "0",
                  points: "0",
                }),
                [field]: value,
              },
            },
          }));
        }}
        onSaveMatch={handleSaveMatch}
        onRevealGroup={handleRevealSwissGroup}
        onOpenMatch={(matchId) => setActiveMatchId(matchId)}
        onCloseMatch={() => setActiveMatchId(null)}
        activeMatchId={activeMatchId}
        onAdvance={handleAdvanceTournament}
        onSync={() => void pullTournamentState()}
        onBack={handleBackFromSwiss}
        isPending={isPending}
        isSyncing={isSyncing}
        feedback={feedback}
      />
    );
  }

  if (state.stage === "completed") {
    return (
      <CompletedTournamentScreen
        state={state}
        onBack={() => {
          setForcedScreen("setup");
          setFeedback(null);
        }}
      />
    );
  }

  return (
    <PlayoffStageScreen
      state={state}
      resultDrafts={resultDrafts}
      onResultDraftChange={(matchId, side, field, value) => {
        const match = state.matches.find((entry) => entry.id === matchId);
        if (!match) {
          return;
        }

        setResultDrafts((current) => ({
          ...current,
          [matchId]: {
            ...(current[matchId] ?? buildResultDraft(match)),
            [side]: {
              ...(current[matchId]?.[side] ?? {
                vacas: "0",
                games: "0",
                points: "0",
              }),
              [field]: value,
            },
          },
        }));
      }}
      onSaveMatch={handleSaveMatch}
      onOpenMatch={(matchId) => setActiveMatchId(matchId)}
      onCloseMatch={() => setActiveMatchId(null)}
      activeMatchId={activeMatchId}
      onAdvance={handleAdvanceTournament}
      onSync={() => void pullTournamentState()}
      onBack={() => {
        setForcedScreen("setup");
        setFeedback(null);
      }}
      isPending={isPending}
      isSyncing={isSyncing}
      feedback={feedback}
    />
  );
}
