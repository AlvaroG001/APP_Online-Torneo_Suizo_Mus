"use client";

/* eslint-disable @next/next/no-img-element */

import QRCode from "qrcode";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
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
          className={`${sizeClasses.margin} first:ml-0 flex ${sizeClasses.frame} items-center justify-center overflow-hidden rounded-full border border-white/15 bg-[#101a2a] font-semibold text-white ${
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
    <span className="whitespace-nowrap rounded-full border border-white/12 bg-white/8 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/74">
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
    <div className="flex items-center gap-3 rounded-[16px] border border-white/10 bg-white/[0.03] px-4 py-3">
      <div className="h-14 w-14 overflow-hidden rounded-full border border-white/12 bg-[#11253d]">
        {player.photoUrl ? (
          <img
            src={player.photoUrl}
            alt={playerName(team, index)}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center font-semibold text-white/74">
            {index === 0 ? "A" : "B"}
          </div>
        )}
      </div>
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/36">
          Integrante {index === 0 ? "A" : "B"}
        </p>
        <p className="mt-1 truncate text-sm font-semibold text-white">
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
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
          Nombre definido desde móvil
        </p>
      )}
    </>
  );
}

function ScreenFrame({
  eyebrow,
  title,
  description,
  leftSlot,
  rightSlot,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#04070d] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_82%_14%,_rgba(37,99,235,0.14),_transparent_26%),linear-gradient(180deg,#060a12_0%,#09111d_52%,#05080f_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] opacity-40" />

      <main className="relative mx-auto flex min-h-screen w-full max-w-[1680px] flex-col px-4 py-5 md:px-8 md:py-8">
        <header className="grid gap-6 rounded-[34px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_35px_120px_rgba(0,0,0,0.28)] backdrop-blur md:grid-cols-[1fr_auto] md:p-8">
          <div className="max-w-4xl">
            {leftSlot ? <div className="mb-5">{leftSlot}</div> : null}
            <p className="font-mono text-xs uppercase tracking-[0.28em] text-[#77cfff]">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-[-0.05em] text-white md:text-7xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-4 max-w-3xl text-sm leading-7 text-white/68 md:text-base">
                {description}
              </p>
            ) : null}
          </div>
          {rightSlot ? <div className="md:justify-self-end">{rightSlot}</div> : null}
        </header>

        <div className="mt-6 flex-1">{children}</div>
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
  isPending,
  feedback,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onUseCurrentOrigin: () => void;
  canUseCurrentOrigin: boolean;
  browserOrigin: string;
  isPending: boolean;
  feedback: FeedbackState | null;
}) {
  return (
    <ScreenFrame
      eyebrow="Paso 1 · Acceso"
      title="Pon primero la URL del torneo"
      description="Esta dirección es la base real del QR general de inscripción. Si los móviles están en la misma Wi‑Fi que tu portátil, aquí va la dirección Network de Next. Si abres el torneo a internet, aquí va el dominio o túnel público."
      rightSlot={
        <div className="flex flex-wrap gap-2">
          <StageBadge label="Mesa privada" />
          <StageBadge label="QR general" />
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-[24px] border border-white/10 bg-[#0b1320] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                En tu red local
              </p>
              <p className="mt-3 text-sm leading-7 text-white/72">
                Usa la dirección `Network` de Next. Esa será la que escaneen todos los
                móviles conectados al router del torneo.
              </p>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-[#0b1320] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                Desde internet
              </p>
              <p className="mt-3 text-sm leading-7 text-white/72">
                Usa la URL pública real, mejor con HTTPS, para que el QR siga valiendo
                fuera de la red local.
              </p>
            </div>
          </div>
        </section>

        <form
          onSubmit={onSubmit}
          className="glass-panel rounded-[30px] bg-white/[0.9] p-6 text-[--foreground]"
        >
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-[--muted]">
            URL base
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-[--foreground]">
            Lo primero que verá cualquier móvil
          </h2>
          <label className="mt-6 block">
            <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
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
          </div>

          {feedback ? (
            <div
              className={`mt-5 rounded-[20px] border px-4 py-3 text-sm leading-6 ${
                feedback.tone === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-900"
              }`}
            >
              {feedback.text}
            </div>
          ) : null}
        </form>
      </div>
    </ScreenFrame>
  );
}

function TournamentSetupScreen({
  form,
  planSummary,
  onChange,
  onSubmit,
  onSaveActiveUrl,
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
  onSaveActiveUrl: () => void;
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
      title="Define el formato del torneo"
      description="Aquí se fija el tamaño del torneo, se deja cerrada la URL activa y se prepara la siguiente pantalla, que ya será el registro por QR y la formación de parejas."
      leftSlot={
        onBackToUrl ? <BackButton label="Volver a la URL" onClick={onBackToUrl} /> : undefined
      }
      rightSlot={
        <div className="rounded-[26px] border border-white/10 bg-white/[0.05] px-5 py-4 text-right">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
            Creada por
          </p>
          <p className="mt-2 text-xl font-semibold text-white">
            Álvaro García Ortiz
          </p>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
        <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
            Qué prepara esta fase
          </p>
          <div className="mt-5 grid gap-4">
            {[
              "Número de parejas objetivo del torneo.",
              "Vacas por partida y juegos por vaca.",
              "Puntos por juego entre 30 y 40.",
              "Formato: suizo solo o suizo + top 4.",
              "URL activa que usará el QR de inscripción.",
            ].map((item) => (
              <div
                key={item}
                className="rounded-[22px] border border-white/10 bg-[#0b1320] px-4 py-4 text-sm leading-7 text-white/72"
              >
                {item}
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-[22px] border border-[#315d8d] bg-[linear-gradient(180deg,rgba(25,44,72,0.9),rgba(10,18,31,0.96))] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              Estructura calculada
            </p>
            <h3 className="mt-2 text-2xl font-semibold text-white">{planSummary.heading}</h3>
            <p className="mt-3 text-sm leading-7 text-white/72">{planSummary.detail}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <StageBadge label={planSummary.roundsLabel} />
              <StageBadge label={formatTournamentFormatLabel(form.format)} />
            </div>
          </div>

          <div className="mt-6 rounded-[22px] border border-[#1c3657] bg-[#09111d] p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              URL activa
            </p>
            <input
              value={form.publicBaseUrl}
              onChange={(event) => onChange({ publicBaseUrl: event.target.value })}
              placeholder="http://192.168.1.41:3000"
              className="input-shell mt-3 border-white/10 bg-[#0b1320] !text-white placeholder:!text-white/45"
            />
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onSaveActiveUrl}
                disabled={isPending}
                className="button-secondary"
              >
                Guardar URL activa
              </button>
              <span className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/62">
                Actual: {publicBaseUrl || "sin definir"}
              </span>
            </div>
          </div>

          {currentStateDetail ? (
            <div className="mt-6 rounded-[22px] border border-[#315d8d] bg-[linear-gradient(180deg,rgba(25,44,72,0.9),rgba(10,18,31,0.96))] p-5">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                Estado actual
              </p>
              <p className="mt-3 text-sm leading-7 text-white/72">{currentStateDetail}</p>
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
          className="glass-panel rounded-[30px] bg-white/[0.9] p-6 text-[--foreground]"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
                Nombre del torneo
              </span>
              <input
                value={form.title}
                onChange={(event) => onChange({ title: event.target.value })}
                className="input-shell mt-2"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
                Tipo de torneo
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
            </label>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
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
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
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
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
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
              <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[--muted]">
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

          {feedback ? (
            <div
              className={`mt-5 rounded-[20px] border px-4 py-3 text-sm leading-6 ${
                feedback.tone === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-900"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-900"
              }`}
            >
              {feedback.text}
            </div>
          ) : null}
        </form>
      </div>
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
  const currentQrDataUrl = qrState.url === registrationUrl ? qrState.dataUrl : "";

  useEffect(() => {
    if (!registrationUrl) {
      return;
    }

    void QRCode.toDataURL(registrationUrl, {
      width: 420,
      margin: 1,
      color: {
        dark: "#07111f",
        light: "#f5fbff",
      },
    }).then((dataUrl) => {
      setQrState({ url: registrationUrl, dataUrl });
    });
  }, [registrationUrl]);

  async function handleCopy(): Promise<void> {
    if (!registrationUrl) {
      return;
    }

    await navigator.clipboard.writeText(registrationUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
            QR de inscripción
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-white">
            Un solo QR para todos los jugadores
          </h3>
          <p className="mt-3 text-sm leading-6 text-white/68">
            Cada móvil entra aquí, registra nombre y foto obligatoria, y queda asociado a ese
            dispositivo para ver luego su pareja y el chat.
          </p>
        </div>
        <button type="button" onClick={() => void handleCopy()} className="button-secondary">
          {copied ? "Copiado" : "Copiar enlace"}
        </button>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[300px_1fr]">
        <div className="rounded-[24px] border border-white/10 bg-[#edf7ff] p-4">
          {currentQrDataUrl ? (
            <img
              src={currentQrDataUrl}
              alt="QR de inscripción"
              className="aspect-square w-full rounded-[18px] object-cover"
            />
          ) : (
            <div className="flex aspect-square items-center justify-center rounded-[18px] border border-dashed border-slate-300 text-sm text-slate-500">
              Generando QR...
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-[22px] border border-white/10 bg-[#0b1320] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              Enlace activo
            </p>
            <p className="mt-3 break-all text-sm leading-6 text-white/74">
              {registrationUrl || "Guarda primero la URL activa del torneo."}
            </p>
          </div>

          <div className="rounded-[22px] border border-white/10 bg-[#0b1320] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
              Qué hace cada móvil
            </p>
            <div className="mt-3 space-y-3 text-sm leading-6 text-white/68">
              <p>1. Escanea el QR.</p>
              <p>2. Rellena nombre y sube una foto obligatoria.</p>
              <p>3. Ese dispositivo queda identificado y luego verá su pareja y el chat.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParticipantCard({
  participant,
  draggable = false,
  dimmed = false,
  onDragStart,
  onDragEnd,
  canRename = false,
  onRename,
  isRenaming = false,
}: {
  participant: Participant;
  draggable?: boolean;
  dimmed?: boolean;
  onDragStart?: (participantId: string) => void;
  onDragEnd?: () => void;
  canRename?: boolean;
  onRename?: (participantId: string, name: string) => void;
  isRenaming?: boolean;
}) {
  const [isEditingName, setIsEditingName] = useState(false);
  const [draftName, setDraftName] = useState(participant.name);

  const isBot = participant.deviceId.startsWith("bot-");

  return (
    <div
      draggable={draggable}
      onClick={() => {
        if (!canRename) {
          return;
        }

        setIsEditingName((current) => {
          if (!current) {
            setDraftName(participant.name);
          }

          return !current;
        });
      }}
      onDragStart={(event) => {
        if (!draggable) {
          return;
        }
        event.dataTransfer.setData("text/participantId", participant.id);
        onDragStart?.(participant.id);
      }}
      onDragEnd={() => onDragEnd?.()}
      className={`rounded-[22px] border border-white/10 bg-[#0b1320] p-4 transition ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${canRename ? "cursor-pointer hover:border-white/22" : ""} ${isEditingName ? "border-[#4fd1ff]/40" : ""} ${dimmed ? "opacity-45" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-[#11253d]">
            <img
              src={participant.photoUrl}
              alt={participant.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div>
            <p className="font-semibold text-white">{participant.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="text-xs text-white/42">
                alta {formatSyncTime(participant.registeredAt)}
              </p>
              {isBot ? (
                <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#77cfff]">
                  bot
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {canRename && isEditingName ? (
        <form
          className="mt-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();

            if (!draftName.trim()) {
              return;
            }

            onRename?.(participant.id, draftName.trim());
            setIsEditingName(false);
          }}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="Nombre del bot"
            className="input-shell !bg-[#101b2d] !text-white placeholder:!text-white/35"
          />
          <button
            type="submit"
            disabled={isRenaming || !draftName.trim()}
            className="button-secondary"
          >
            {isRenaming ? "Guardando" : "Guardar"}
          </button>
        </form>
      ) : null}
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
      className={`rounded-[20px] border border-dashed p-4 ${
        filled ? "border-white/12 bg-white/[0.04]" : "border-[#5ecfff]/34 bg-[#08111d]"
      }`}
    >
      {filled ? (
        <div className="flex items-center gap-3 text-left">
          <div className="h-[72px] w-[72px] overflow-hidden rounded-full border border-white/12 bg-[#11253d]">
            {player.photoUrl ? (
              <img
                src={player.photoUrl}
                alt={player.name}
                className="h-full w-full object-cover"
              />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-white">{player.name}</p>
            <p className="mt-1 text-xs text-white/42">Plaza {slot}</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-24 items-center justify-center text-center text-sm leading-6 text-white/46">
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
  renamingParticipantId,
  onCreateRandomTeams,
  onPrepareManualTeams,
  onAssignParticipant,
  onStartTournament,
  isPending,
  feedback,
}: {
  state: TournamentState;
  registrationUrl: string;
  onBack: () => void;
  onAddBotParticipant: () => void;
  onRenameParticipant: (participantId: string, name: string) => void;
  renamingParticipantId: string | null;
  onCreateRandomTeams: () => void;
  onPrepareManualTeams: () => void;
  onAssignParticipant: (
    teamId: string,
    slot: PlayerSlot,
    participantId: string | null,
  ) => void;
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
    state.teams.every((team) => isTeamComplete(team));
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
        title="Registra a los jugadores y monta las parejas"
        leftSlot={<BackButton label="Volver a configuración" onClick={onBack} />}
        rightSlot={
          <div className="flex flex-wrap gap-2">
            <StageBadge label={`${registeredCount}/${expectedParticipants} personas`} />
            <StageBadge label={`${state.config.teamCount} parejas`} />
            <StageBadge label={state.teamCreationMode === "pending" ? "sin parejas" : state.teamCreationMode === "random" ? "modo aleatorio" : "modo manual"} />
          </div>
        }
      >
        <div className="space-y-6">
          <section
            className={`launch-panel ${teamsReady ? "launch-panel-ready" : "launch-panel-blocked"} ${
              launchFxVisible ? "launch-panel-firing" : ""
            }`}
          >
            <div className="launch-panel-orb launch-panel-orb-left" />
            <div className="launch-panel-orb launch-panel-orb-right" />
            <div className="relative z-10 flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
              <div className="max-w-3xl">
                <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-[#9ee5ff]">
                  Lanzamiento del torneo
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-[-0.05em] text-white md:text-4xl">
                  {teamsReady
                    ? "Todo está listo para abrir la primera fase."
                    : "Cierra primero todas las parejas para poder arrancar."}
                </h2>
                {!(teamsReady && structure.entryStage === "swiss") ? (
                  <p className="mt-3 text-sm leading-7 text-white/62 md:text-base">
                    {teamsReady
                      ? structure.entryStage === "semifinals"
                        ? "Al pulsar se preparan directamente las semifinales y la mesa salta al cuadro eliminatorio."
                        : "Al pulsar se abre la final directa y la mesa entra ya en la pantalla de resultado."
                      : "Este botón se activará en cuanto todas las plazas estén completas y todas las parejas tengan sus dos integrantes."}
                  </p>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2">
                  <StageBadge
                    label={`${state.teams.filter((team) => isTeamComplete(team)).length}/${state.config.teamCount} parejas listas`}
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
                  <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-white/74">
                    {isPending ? "Preparando" : "Acción principal"}
                  </span>
                  <span className="mt-1 text-lg font-semibold tracking-[0.02em] text-white">
                    {isPending ? "Montando cuadro..." : "Empezar torneo"}
                  </span>
                </span>
              </button>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-6">
              <RegistrationQrCard registrationUrl={registrationUrl} />

              <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                      Estado del registro
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-white">
                      {registrationComplete
                        ? "Ya están todos los jugadores"
                        : `Faltan ${remainingCount} personas por entrar`}
                    </h3>
                  </div>
                  <span className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/62">
                    {participantCountIsEven ? "conteo par" : "conteo impar"}
                  </span>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-3">
                  <div className="rounded-[22px] border border-white/10 bg-[#0b1320] p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                      Registrados
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-white">{registeredCount}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-[#0b1320] p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                      Objetivo
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-white">{expectedParticipants}</p>
                  </div>
                  <div className="rounded-[22px] border border-white/10 bg-[#0b1320] p-4">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                      Parejas listas
                    </p>
                    <p className="mt-3 text-3xl font-semibold text-white">
                      {state.teams.filter((team) => isTeamComplete(team)).length}
                    </p>
                  </div>
                </div>

                <div className="mt-5 flex flex-wrap gap-3">
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

                <div className="mt-5 flex flex-wrap gap-2">
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
                  <div className="mt-5 rounded-[20px] border border-white/10 bg-[#0b1320] px-4 py-3 text-sm leading-6 text-white/68">
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

            <div>
              {state.teamCreationMode === "pending" ? (
                <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                        Personas registradas
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">
                        Van apareciendo en directo
                      </h3>
                    </div>
                    <span className="rounded-full border border-white/12 bg-white/6 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-white/62">
                      {registeredCount}/{expectedParticipants}
                    </span>
                  </div>

                  <div className="mt-5 grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {state.participants.map((participant) => (
                      <ParticipantCard
                        key={participant.id}
                        participant={participant}
                        dimmed={assignedParticipantIds.has(participant.id)}
                        canRename={participant.deviceId.startsWith("bot-")}
                        onRename={onRenameParticipant}
                        isRenaming={renamingParticipantId === participant.id}
                      />
                    ))}
                    {state.participants.length === 0 ? (
                      <div className="rounded-[22px] border border-dashed border-white/12 bg-[#0b1320] px-5 py-8 text-sm leading-7 text-white/48 md:col-span-2 2xl:col-span-3">
                        En cuanto los móviles empiecen a escanear el QR, aquí aparecerán sus nombres y fotos.
                      </div>
                    ) : null}
                  </div>
                </section>
              ) : (
                <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                        Parejas resultantes
                      </p>
                      <h3 className="mt-2 text-2xl font-semibold text-white">
                        Vista previa antes de pasar al torneo
                      </h3>
                      {state.teamCreationMode === "manual" ? (
                        <p className="mt-2 text-sm leading-6 text-white/58">
                          Pulsa cada plaza y elige a la persona entre las que siguen libres.
                        </p>
                      ) : null}
                    </div>
                    <StageBadge label={`${state.teams.length}/${state.config.teamCount} parejas`} />
                  </div>

                  <div className="mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                    {state.teams.map((team) => (
                      <div
                        key={`preview-top-${team.id}`}
                        className="rounded-[24px] border border-white/10 bg-[#0b1320] p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-lg font-semibold text-white">
                              {team.nameIsCustom ? team.name : team.label}
                            </p>
                          </div>
                          {state.teamCreationMode === "manual" ? (
                            <span className="rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
                              seleccionar
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
            <section className="rounded-[30px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                    Parejas resultantes
                  </p>
                  <h3 className="mt-2 text-2xl font-semibold text-white">
                    Vista previa antes de pasar al torneo
                  </h3>
                </div>
                <StageBadge label={`${state.teams.length}/${state.config.teamCount} parejas`} />
              </div>

              <div className="mt-5 grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
                {state.teams.map((team) => (
                  <div
                    key={`preview-${team.id}`}
                    className="rounded-[24px] border border-white/10 bg-[#0b1320] p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-lg font-semibold text-white">
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

          {feedback ? (
            <div
              className={`rounded-[20px] border px-4 py-3 text-sm leading-6 ${
                feedback.tone === "success"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                  : "border-rose-500/20 bg-rose-500/10 text-rose-200"
              }`}
            >
              {feedback.text}
            </div>
          ) : null}
        </div>
      </ScreenFrame>

      {activeManualPicker && pickerTeam ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-auto rounded-[30px] border border-white/10 bg-[#08111d] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77cfff]">
                  Selección manual
                </p>
                <h3 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-white">
                  {pickerTeam.label} · plaza {activeManualPicker.slot}
                </h3>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-white/62">
                  Elige a una persona libre para esta plaza. Si ya había alguien dentro,
                  también puedes liberar el hueco o dejar a la misma persona.
                </p>
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
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3">
                <div>
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/42">
                    Plaza actual
                  </p>
                  <p className="mt-1 text-base font-semibold text-white">{pickerPlayer.name}</p>
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
                    className={`rounded-[24px] border p-4 text-left transition ${
                      isCurrent
                        ? "border-[#6dd1ff]/40 bg-[#0c1a29]"
                        : "border-white/10 bg-white/[0.03] hover:border-white/24"
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-[#11253d]">
                        <img
                          src={participant.photoUrl}
                          alt={participant.name}
                          className="h-full w-full object-cover"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-lg font-semibold text-white">
                            {participant.name}
                          </p>
                          {participant.deviceId.startsWith("bot-") ? (
                            <span className="rounded-full border border-white/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#77cfff]">
                              bot
                            </span>
                          ) : null}
                          {isCurrent ? (
                            <span className="rounded-full border border-[#6dd1ff]/24 bg-[#6dd1ff]/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] text-[#9ee5ff]">
                              actual
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-xs text-white/42">
                          alta {formatSyncTime(participant.registeredAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}

              {pickerOptions.length === 0 ? (
                <div className="rounded-[24px] border border-dashed border-white/12 bg-[#0b1320] px-5 py-8 text-sm leading-7 text-white/48 md:col-span-2">
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
      <div className="rounded-[18px] border border-white/18 bg-white/[0.03] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
          mesa {match.table}
        </p>
        <div className="mt-3 flex flex-col items-center text-center">
          <TeamFaces team={teamA} size="lg" />
          <p className="mt-4 text-base font-semibold text-white">{teamA.name}</p>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-[#77cfff]">
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
      className="w-full rounded-[18px] border border-white/18 bg-white/[0.03] p-4 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-white/28 hover:bg-white/[0.05]"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
          mesa {match.table}
        </p>
        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/42">
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
              className={`grid w-full max-w-full min-w-0 items-center gap-3 overflow-hidden rounded-[16px] px-3 py-2 ${
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
                              : "text-white"
                        }`}
                      >
                        {team.name}
                      </p>
                      <p className="truncate text-[11px] text-white/40">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                  <div className="flex h-10 min-w-[50px] flex-none items-center justify-center rounded-[10px] border border-white/40 bg-black px-3 font-mono text-base font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    {score}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex h-10 min-w-[50px] flex-none items-center justify-center rounded-[10px] border border-white/40 bg-black px-3 font-mono text-base font-extrabold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
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
                              : "text-white"
                        }`}
                      >
                        {team.name}
                      </p>
                      <p className="truncate text-[11px] text-white/40">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>

            {index === 0 ? (
              <div className="mt-3 flex items-center gap-3">
                <div className="h-[2px] flex-1 bg-white/20" />
                <div className="rounded-full border border-white/10 bg-white/6 px-3 py-2 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-white/46">
                  vs
                </div>
                <div className="h-[2px] flex-1 bg-white/20" />
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
    <div className="flex h-full min-h-[420px] flex-col justify-between rounded-[24px] border border-white/10 bg-black/55 p-5">
      <div className="flex flex-col items-center text-center">
        <TeamFaces team={team} size="xl" />
        <p className="mt-5 text-2xl font-semibold text-white">{team.name}</p>
        <p className="mt-2 text-sm text-white/42">
          {playerName(team, 0)} · {playerName(team, 1)}
        </p>
        <span className="mt-4 rounded-full border border-white/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
          {team.wins}-{team.losses}
        </span>
      </div>

      <div className={`mt-8 ${pointsOnlyMode ? "grid gap-3" : "grid grid-cols-3 gap-3"}`}>
        {scoreFields.map(([field, label]) => (
          <label key={field} className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
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
              className="input-shell mt-2 !bg-[#101a2d] !text-white text-center text-xl font-semibold placeholder:!text-white/25 [appearance:textfield]"
              style={{ WebkitTextFillColor: "#ffffff" }}
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
    <div className="relative min-h-screen overflow-hidden bg-[#020409] text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.14),_transparent_24%),radial-gradient(circle_at_84%_12%,_rgba(99,102,241,0.16),_transparent_22%),linear-gradient(180deg,#03060b_0%,#02040a_100%)]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {columns.map((column) => (
          <div
            key={`ghost-${column.depth}`}
            className="absolute top-8 text-[28rem] font-black leading-none tracking-[-0.08em] text-white/[0.035]"
            style={{ left: `${column.depth * 18 + 1}rem` }}
          >
            {column.depth}
          </div>
        ))}
      </div>

      <main className="relative mx-auto flex min-h-screen max-w-[1880px] flex-col px-4 py-5 md:px-8 md:py-8">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <BackButton label="Volver al registro" onClick={onBack} />
            <p className="mt-5 font-mono text-xs uppercase tracking-[0.28em] text-[#77cfff]">
              Paso 4 · Swiss Stage
            </p>
            <h1 className="mt-2 text-5xl font-black tracking-[-0.07em] text-white md:text-8xl">
              SWISS STAGE
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-white/62 md:text-base">
              Cada tramo se sortea con su botón. Después pinchas solo la mesa que quieras
              abrir para meter el resultado sin desplegar el resto.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <StageBadge label={`Ronda ${state.currentSwissRound}`} />
            <StageBadge label={`Sync ${formatSyncTime(state.updatedAt)}`} />
            <StageBadge label={state.config.title} />
          </div>
        </header>

        {feedback ? (
          <section
            className={`mt-5 rounded-[20px] border px-4 py-3 text-sm leading-6 ${
              feedback.tone === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/20 bg-rose-500/10 text-rose-200"
            }`}
          >
            {feedback.text}
          </section>
        ) : null}

        <section className="mt-5 flex flex-wrap items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#77cfff]">
            Estado de la ronda
          </span>
          <div className="h-px w-8 bg-white/12" />
          <p className="text-sm text-white/74 md:text-base">
            Quedan{" "}
            <span className="font-semibold text-white">{pendingMatchesCount}</span>{" "}
            enfrentamientos por cerrar en esta fase.
          </p>
        </section>

        <section className="mt-6 flex-1 overflow-x-auto pb-6">
          <div className="flex min-w-max gap-10 pr-8">
            {columns.map((column) => (
              <div key={column.depth} className="w-[320px] flex-none">
                <div className="mb-4 flex items-center justify-between">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-white/36">
                    tramo {column.depth}
                  </p>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <div className="space-y-5">
                  {column.boxes.map((box) => {
                    const hasContent = box.matches.length > 0 || box.teams.length > 0;
                    const shouldShowDrawButton =
                      box.isEditable &&
                      box.hiddenMatches.length > 0 &&
                      box.revealedMatches.length === 0;

                    return (
                      <div
                        key={box.label}
                        className={`relative overflow-hidden rounded-[24px] border ${
                          box.isEditable
                            ? "border-[#6dd1ff] shadow-[0_18px_60px_rgba(14,165,233,0.16)]"
                            : "border-white/10"
                        } ${hasContent ? "bg-black/88" : "bg-black/50"}`}
                      >
                        <div
                          className={`flex items-center justify-between border-b px-4 py-3 ${
                            box.isEditable
                              ? "border-[#6dd1ff]/40 bg-[linear-gradient(90deg,#5b8cff,#7d6dff)] text-white"
                              : "border-white/10 bg-white text-black"
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

                        <div className="min-h-[260px] p-4">
                          {box.revealedMatches.length > 0 ? (
                            <div className="space-y-3">
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
                            <div className="space-y-3">
                              {box.teams.map((team, index) => (
                                <div
                                  key={team.id}
                                  className="stagger-rise flex items-center justify-between gap-3 rounded-[18px] border border-white/10 bg-white/[0.03] px-4 py-3"
                                  style={{ animationDelay: `${index * 70}ms` }}
                                >
                                  <div className="flex min-w-0 items-center gap-4">
                                    <TeamFaces team={team} size="md" />
                                    <div className="min-w-0">
                                      <p className="truncate text-base font-semibold text-white">
                                        {team.name}
                                      </p>
                                      <p className="truncate text-[11px] text-white/42">
                                        {playerName(team, 0)} · {playerName(team, 1)}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[#77cfff]">
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
                            <div className="flex min-h-[228px] items-center justify-center text-center text-sm leading-7 text-white/20">
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

        <footer className="sticky bottom-0 mt-2 flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-black/70 px-5 py-4 backdrop-blur">
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

      {activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-[30px] border border-white/10 bg-[#08111d] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77cfff]">
                  Mesa activa
                </p>
                <h2 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-white">
                  {activeMatch.bracketLabel} · mesa {activeMatch.table}
                </h2>
              </div>
              <button type="button" onClick={onCloseMatch} className="button-secondary">
                Cerrar
              </button>
            </div>

            <article className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
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
                  <div className="rounded-full border border-white/10 bg-white/6 px-6 py-5 text-center font-mono text-sm uppercase tracking-[0.22em] text-white/46">
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
  const description = isSemifinals
    ? "La clasificación ya ha decidido esta fase. Abre solo la mesa que quieras cerrar y, cuando estén todas completas, pasa a la final."
    : "Aquí se cierra el último enfrentamiento del torneo. Cuando la final esté completa podrás dejar el torneo terminado.";
  const advanceLabel = isSemifinals ? "Pasar a la final" : "Cerrar torneo";

  return (
    <ScreenFrame
      eyebrow={isSemifinals ? "Fase final · Semifinales" : "Fase final · Final"}
      title={title}
      description={description}
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
        {feedback ? (
          <section
            className={`rounded-[20px] border px-4 py-3 text-sm leading-6 ${
              feedback.tone === "success"
                ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-200"
                : "border-rose-500/20 bg-rose-500/10 text-rose-200"
            }`}
          >
            {feedback.text}
          </section>
        ) : null}

        <section className="flex flex-wrap items-center gap-3 rounded-[22px] border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[#77cfff]">
            Estado de la fase
          </span>
          <div className="h-px w-8 bg-white/12" />
          <p className="text-sm text-white/74 md:text-base">
            Quedan{" "}
            <span className="font-semibold text-white">{pendingMatchesCount}</span>{" "}
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

        <footer className="flex flex-wrap items-center justify-between gap-4 rounded-[28px] border border-white/10 bg-black/40 px-5 py-4 backdrop-blur">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-6xl overflow-auto rounded-[30px] border border-white/10 bg-[#08111d] p-6 shadow-[0_30px_120px_rgba(0,0,0,0.4)]">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.24em] text-[#77cfff]">
                  Mesa activa
                </p>
                <h2 className="mt-2 text-4xl font-semibold tracking-[-0.05em] text-white">
                  {activeMatch.bracketLabel}
                </h2>
              </div>
              <button type="button" onClick={onCloseMatch} className="button-secondary">
                Cerrar
              </button>
            </div>

            <article className="mt-6 rounded-[24px] border border-white/10 bg-white/[0.03] p-5">
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
                  <div className="rounded-full border border-white/10 bg-white/6 px-6 py-5 text-center font-mono text-sm uppercase tracking-[0.22em] text-white/46">
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
  const description = isSwissClassificationEnd
    ? `El torneo terminó tras ${structure.swissRounds} rondas suizas. La clasificación final queda ordenada por victorias y desempates automáticos.`
    : "El torneo ya ha quedado cerrado. Aquí tienes el resultado final y el ranking del torneo.";

  return (
    <ScreenFrame
      eyebrow="Resumen final"
      title={title}
      description={description}
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
                  className="rounded-[28px] border border-white/10 bg-white/[0.04] p-5 backdrop-blur"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[#77cfff]">
                    {index === 0 ? "campeón" : "subcampeón"}
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <TeamFaces team={team} />
                    <div>
                      <p className="text-xl font-semibold text-white">{team.name}</p>
                      <p className="text-sm text-white/42">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </div>
                );
              })}
          </section>
        ) : null}

        <section className="overflow-x-auto rounded-[30px] border border-white/10 bg-white/[0.04] backdrop-blur">
          <div className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px] gap-3 border-b border-white/10 bg-white/[0.03] px-5 py-4 font-mono text-[11px] uppercase tracking-[0.18em] text-white/48">
            <span>Puesto</span>
            <span>Equipo</span>
            <span>Balance</span>
            <span>Buchholz</span>
            <span>Vacas</span>
            <span>Juegos</span>
            <span>Puntos</span>
          </div>

          <div className="divide-y divide-white/10">
            {state.teams.map((team, index) => (
              <div
                key={team.id}
                className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px] gap-3 px-5 py-4"
              >
                <div className="text-lg font-semibold text-white">{index + 1}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <TeamFaces team={team} size="sm" />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-white">{team.name}</p>
                      <p className="truncate text-sm text-white/42">
                        {playerName(team, 0)} · {playerName(team, 1)}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="text-sm font-semibold text-white">
                  {team.wins}-{team.losses}
                </div>
                <div className="text-sm text-white/72">{team.buchholz}</div>
                <div className="text-sm text-white/72">{team.vacasWon}</div>
                <div className="text-sm text-white/72">{team.gamesWon}</div>
                <div className="text-sm text-white/72">{team.pointsWon}</div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </ScreenFrame>
  );
}

export function TournamentFlow({ initialState }: TournamentFlowProps) {
  const [state, setState] = useState(initialState);
  const [forcedScreen, setForcedScreen] = useState<Screen | null>(null);
  const [setupForm, setSetupForm] = useState<SetupFormState>(() =>
    buildSetupForm(initialState),
  );
  const [resultDrafts, setResultDrafts] = useState<Record<string, ResultDraft>>({});
  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [renamingParticipantId, setRenamingParticipantId] = useState<string | null>(null);
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
          setFeedback({ tone: "success", text: successMessage });
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
          ? `${state.teams.filter((team) => isTeamComplete(team)).length}/${state.config.teamCount} parejas cerradas.`
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
        onSaveActiveUrl={handleUpdateActiveUrl}
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
        renamingParticipantId={renamingParticipantId}
        onCreateRandomTeams={handleCreateRandomTeams}
        onPrepareManualTeams={handlePrepareManualTeams}
        onAssignParticipant={handleAssignParticipant}
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
