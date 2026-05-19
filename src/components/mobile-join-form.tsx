/* eslint-disable @next/next/no-img-element */

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { InfoHint } from "@/components/info-hint";
import { TournamentWatermark } from "@/components/tournament-watermark";
import type {
  Match,
  MatchScore,
  Participant,
  Team,
  TournamentState,
} from "@/lib/tournament";
import {
  canDeviceSubmitTeamResult,
  getMatchMobileResultConflict,
  getRankedTeams,
  getTournamentStructure,
  isTeamComplete,
  isPointsOnlyMatchFormat,
} from "@/lib/tournament";

interface MobileJoinFormProps {
  initialState: TournamentState;
}

interface MobileResultDraft {
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

interface PendingMobileResultConfirmation {
  matchId: string;
  score: MatchScore;
}

interface AdminMatchEditor {
  matchId: string;
}

type MobileTab = "player" | "standings" | "admin";

const DEVICE_STORAGE_KEY = "torneo-mus-device-id";
const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const CAMERA_SAFE_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_IMAGE_DIMENSION = 1800;

function createDeviceId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `device-${Math.random().toString(36).slice(2)}`;
}

function readDeviceCookie(): string | null {
  const cookie = document.cookie
    .split("; ")
    .find((entry) => entry.startsWith(`${DEVICE_STORAGE_KEY}=`));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.split("=").slice(1).join("=")).trim() || null;
  } catch {
    return null;
  }
}

function writeDeviceCookie(deviceId: string): void {
  document.cookie = `${DEVICE_STORAGE_KEY}=${encodeURIComponent(
    deviceId,
  )}; Max-Age=${DEVICE_COOKIE_MAX_AGE}; Path=/; SameSite=Lax`;
}

function readStoredDeviceId(): string | null {
  try {
    return window.localStorage.getItem(DEVICE_STORAGE_KEY)?.trim() || null;
  } catch {
    return null;
  }
}

function persistDeviceId(deviceId: string): void {
  try {
    window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceId);
  } catch {
    // La cookie mantiene identidad cuando localStorage no esté disponible.
  }

  writeDeviceCookie(deviceId);
}

function resolveDeviceId(): string {
  const storedDeviceId = readStoredDeviceId();
  const cookieDeviceId = readDeviceCookie();
  const nextDeviceId = storedDeviceId || cookieDeviceId || createDeviceId();
  persistDeviceId(nextDeviceId);
  return nextDeviceId;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("No se ha podido preparar la imagen."));
    image.src = url;
  });
}

function getScaledDimensions(width: number, height: number): {
  width: number;
  height: number;
} {
  const longestSide = Math.max(width, height);

  if (longestSide <= MAX_IMAGE_DIMENSION) {
    return { width, height };
  }

  const scale = MAX_IMAGE_DIMENSION / longestSide;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function mirrorSelfieFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || !CAMERA_SAFE_IMAGE_TYPES.has(file.type)) {
    return file;
  }

  const sourceUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(sourceUrl);
    const canvas = document.createElement("canvas");
    const originalWidth = image.naturalWidth || image.width;
    const originalHeight = image.naturalHeight || image.height;
    const scaled = getScaledDimensions(originalWidth, originalHeight);
    canvas.width = scaled.width;
    canvas.height = scaled.height;
    const context = canvas.getContext("2d");

    if (!context) {
      return file;
    }

    context.translate(canvas.width, 0);
    context.scale(-1, 1);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    const mirroredBlob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.9);
    });

    if (!mirroredBlob) {
      return file;
    }

    return new File([mirroredBlob], file.name, {
      type: "image/jpeg",
      lastModified: file.lastModified,
    });
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function formatStageLabel(stage: TournamentState["stage"]): string {
  switch (stage) {
    case "swiss":
      return "Swiss Stage";
    case "league":
      return "Liga";
    case "semifinals":
      return "Semifinales";
    case "final":
      return "Final";
    case "leagueSemifinals":
      return "Semifinales de liga";
    case "leagueFinals":
      return "Finales de liga";
    case "completed":
      return "Terminado";
    case "setup":
    default:
      return "Preparación";
  }
}

function formatTime(value: string): string {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return "--:--";
  }

  return new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getParticipantTeam(state: TournamentState, participant: Participant | null): Team | null {
  if (!participant?.teamId) {
    return null;
  }

  return state.teams.find((team) => team.id === participant.teamId) ?? null;
}

function getTeamMatches(state: TournamentState, teamId: string): Match[] {
  return state.matches.filter(
    (match) => match.teamAId === teamId || match.teamBId === teamId,
  );
}

function getOpponent(match: Match, team: Team, state: TournamentState): Team | null {
  const opponentId = match.teamAId === team.id ? match.teamBId : match.teamAId;
  return opponentId ? state.teams.find((entry) => entry.id === opponentId) ?? null : null;
}

function getMatchSortValue(match: Match): number {
  const stageOrder =
    match.stage === "swiss"
      ? 0
      : match.stage === "league"
        ? 20
        : match.stage === "semifinal" || match.stage === "leagueSemifinal"
          ? 100
          : 200;
  return stageOrder + match.roundIndex * 10 + match.table;
}

function getMatchHeading(match: Match): string {
  if (match.stage === "swiss") {
    return `Ronda ${match.roundIndex} · ${match.bracketLabel}`;
  }

  if (match.stage === "league") {
    return `Liga · Ronda ${match.roundIndex}`;
  }

  if (match.stage === "semifinal" || match.stage === "leagueSemifinal") {
    return match.bracketLabel;
  }

  return "Final";
}

function getPerspectiveScore(
  match: Match,
  teamId: string,
): {
  own: {
    vacas: number;
    games: number;
    points: number;
  };
  opponent: {
    vacas: number;
    games: number;
    points: number;
  };
} | null {
  if (!match.score) {
    return null;
  }

  const isTeamA = match.teamAId === teamId;
  const own = isTeamA ? match.score.teamA : match.score.teamB;
  const opponent = isTeamA ? match.score.teamB : match.score.teamA;

  return { own, opponent };
}

function getPerspectiveResultLabel(match: Match, teamId: string): string {
  if (match.bye) {
    return "Descanso";
  }

  if (!match.revealed && match.stage === "swiss") {
    return "Sin sortear";
  }

  if (match.status !== "completed") {
    return "Pendiente";
  }

  if (match.winnerId === teamId) {
    return "Victoria";
  }

  if (match.loserId === teamId) {
    return "Derrota";
  }

  return "Cerrado";
}

function buildMobileResultDraft(match: Match, teamId: string | null): MobileResultDraft {
  const ownReport = teamId
    ? match.mobileResultReports?.find((report) => report.teamId === teamId)
    : null;
  const score = ownReport?.score ?? match.score;

  return {
    teamA: {
      vacas: String(score?.teamA.vacas ?? 0),
      games: String(score?.teamA.games ?? 0),
      points: String(score?.teamA.points ?? 0),
    },
    teamB: {
      vacas: String(score?.teamB.vacas ?? 0),
      games: String(score?.teamB.games ?? 0),
      points: String(score?.teamB.points ?? 0),
    },
  };
}

function mobileDraftToScore(draft: MobileResultDraft, pointsOnlyMode: boolean): MatchScore {
  return {
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
}

function scoreSummary(score: MatchScore, pointsOnlyMode: boolean): string {
  return pointsOnlyMode
    ? `${score.teamA.points}-${score.teamB.points}`
    : `${score.teamA.vacas}-${score.teamB.vacas} vacas · ${score.teamA.games}-${score.teamB.games} juegos · ${score.teamA.points}-${score.teamB.points} puntos`;
}

function playerName(team: Team, index: number): string {
  return team.players[index]?.name || `Jugador ${index + 1}`;
}

function MobileTeamFaces({ team }: { team: Team }) {
  return (
    <div className="flex items-center">
      {team.players.map((player, index) => (
        <div
          key={`${team.id}-${player.slot}-mobile-face`}
          className={`flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)] text-xs font-semibold text-[var(--foreground)] ${
            index === 1 ? "-ml-2" : ""
          }`}
        >
          {player.photoUrl ? (
            <img
              src={player.photoUrl}
              alt={playerName(team, index)}
              className="h-full w-full object-cover"
            />
          ) : (
            <span>{player.slot}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function getMobileStandingsBandClass(rank: number): string {
  if (rank <= 4) {
    return "border-[var(--accent-border)] bg-[rgba(124,255,79,0.14)]";
  }

  if (rank <= 8) {
    return "border-sky-300/30 bg-sky-400/10";
  }

  if (rank <= 12) {
    return "border-amber-300/28 bg-amber-300/9";
  }

  return "border-[var(--stroke)] bg-[var(--surface-strong)]";
}

function MobileStandingsPanel({ state }: { state: TournamentState }) {
  const isLeague = state.config.format === "league";
  const rankedTeams = getRankedTeams(state);

  return (
    <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
            Clasificación
          </p>
          <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
            {state.config.title}
          </h2>
        </div>
        <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
          {rankedTeams.length} parejas
        </span>
      </div>

      <div className="mt-5 space-y-2">
        {rankedTeams.map((entry, index) => {
          const rank = index + 1;

          return (
            <article
              key={`${entry.id}-mobile-standings`}
              className={`rounded-[8px] border px-3 py-3 ${getMobileStandingsBandClass(rank)}`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] bg-[rgba(2,4,3,0.46)] font-mono text-sm font-bold text-[var(--foreground)]">
                    {rank}
                  </span>
                  <MobileTeamFaces team={entry} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                      {entry.name}
                    </p>
                    <p className="truncate text-xs text-[var(--muted-soft)]">
                      {playerName(entry, 0)} · {playerName(entry, 1)}
                    </p>
                  </div>
                </div>
                <span className="flex h-9 min-w-10 shrink-0 items-center justify-center rounded-[7px] border border-[var(--accent-border)] bg-[var(--background)] font-mono text-sm font-black text-[var(--accent)]">
                  {isLeague ? entry.leaguePoints : `${entry.wins}-${entry.losses}`}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-[7px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.34)] px-2 py-1.5">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                    Vacas
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                    {entry.vacasWon}
                  </p>
                </div>
                <div className="rounded-[7px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.34)] px-2 py-1.5">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                    Juegos
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                    {entry.gamesWon}
                  </p>
                </div>
                <div className="rounded-[7px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.34)] px-2 py-1.5">
                  <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                    Puntos
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[var(--foreground)]">
                    {entry.pointsWon}
                  </p>
                </div>
              </div>
            </article>
          );
        })}

        {rankedTeams.length === 0 ? (
          <p className="rounded-[8px] border border-dashed border-[var(--stroke)] bg-[rgba(2,4,3,0.24)] px-4 py-8 text-center text-sm leading-6 text-[var(--muted)]">
            La clasificación aparecerá cuando la mesa cree las parejas.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function getCurrentMobileAdminMatches(state: TournamentState): Match[] {
  if (state.stage === "swiss") {
    return state.matches.filter(
      (match) =>
        match.stage === "swiss" &&
        (!match.marker || match.marker === "autoWin") &&
        match.roundIndex === state.currentSwissRound,
    );
  }

  if (state.stage === "league") {
    return state.matches.filter(
      (match) =>
        match.stage === "league" && match.roundIndex === state.currentSwissRound,
    );
  }

  if (state.stage === "semifinals") {
    return state.matches.filter((match) => match.stage === "semifinal");
  }

  if (state.stage === "final") {
    return state.matches.filter((match) => match.stage === "final");
  }

  if (state.stage === "leagueSemifinals") {
    return state.matches.filter((match) => match.stage === "leagueSemifinal");
  }

  if (state.stage === "leagueFinals") {
    return state.matches.filter((match) => match.stage === "leagueFinal");
  }

  return [];
}

function getNextMobileAdminGroupLabel(state: TournamentState): string | null {
  const hiddenMatch = getCurrentMobileAdminMatches(state).find(
    (match) =>
      (match.stage === "swiss" || match.stage === "league") &&
      !match.revealed &&
      !match.marker,
  );

  return hiddenMatch?.bracketLabel ?? null;
}

function getAdminMatchTeam(
  state: TournamentState,
  match: Match | null,
  side: "teamA" | "teamB",
): Team | null {
  const teamId = side === "teamA" ? match?.teamAId : match?.teamBId;
  return teamId ? state.teams.find((entry) => entry.id === teamId) ?? null : null;
}

export function MobileJoinForm({ initialState }: MobileJoinFormProps) {
  const [state, setState] = useState(initialState);
  const [deviceId, setDeviceId] = useState("");
  const [deviceIdReady, setDeviceIdReady] = useState(false);
  const [name, setName] = useState("");
  const [teamNameInput, setTeamNameInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTab>("player");
  const [adminPassword, setAdminPassword] = useState("");
  const [isClaimingAdmin, setIsClaimingAdmin] = useState(false);
  const [isAdminActionPending, setIsAdminActionPending] = useState(false);
  const [adminParticipantNames, setAdminParticipantNames] = useState<Record<string, string>>({});
  const [adminMatchEditor, setAdminMatchEditor] = useState<AdminMatchEditor | null>(null);
  const [adminResultDrafts, setAdminResultDrafts] = useState<Record<string, MobileResultDraft>>({});
  const [chatInput, setChatInput] = useState("");
  const [mobileResultDrafts, setMobileResultDrafts] = useState<
    Record<string, MobileResultDraft>
  >({});
  const [pendingMobileResultConfirmation, setPendingMobileResultConfirmation] =
    useState<PendingMobileResultConfirmation | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isSavingTeamName, setIsSavingTeamName] = useState(false);
  const [isSubmittingMobileResult, setIsSubmittingMobileResult] = useState(false);
  const previewObjectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4500);

    try {
      const nextDeviceId = resolveDeviceId();
      setDeviceId(nextDeviceId);
    } catch {
      const fallbackDeviceId = createDeviceId();
      setDeviceId(fallbackDeviceId);
      try {
        persistDeviceId(fallbackDeviceId);
      } catch {
        // Si el navegador bloquea almacenamiento, el registro seguirá funcionando en memoria.
      }
    }

    void fetch("/api/tournament", {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => response.json())
      .then((payload: TournamentState | { error: string }) => {
        if (active && !("error" in payload)) {
          setState(payload);
        }
      })
      .catch(() => {
        if (active) {
          setFeedback("No se ha podido sincronizar todavía. Puedes registrarte y se reintentará solo.");
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (active) {
          setDeviceIdReady(true);
        }
      });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void fetch("/api/tournament", { cache: "no-store" })
        .then((response) => response.json())
        .then((payload: TournamentState | { error: string }) => {
          if (!("error" in payload)) {
            setState(payload);
          }
        })
        .catch(() => undefined);
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, []);

  const expectedParticipants = state.config.teamCount * 2;
  const participant = useMemo(
    () =>
      deviceId
        ? state.participants.find((entry) => entry.deviceId === deviceId) ?? null
        : null,
    [deviceId, state.participants],
  );
  const team = useMemo(
    () => getParticipantTeam(state, participant),
    [participant, state],
  );
  const teamMatches = useMemo(
    () => (team ? getTeamMatches(state, team.id) : []),
    [state, team],
  );
  const sortedTeamMatches = useMemo(
    () =>
      teamMatches
        .slice()
        .sort((left, right) => getMatchSortValue(left) - getMatchSortValue(right)),
    [teamMatches],
  );
  const visibleTeamMatches = useMemo(
    () =>
      sortedTeamMatches.filter(
        (match) =>
          (match.stage !== "swiss" && match.stage !== "league") || match.revealed,
      ),
    [sortedTeamMatches],
  );
  const participantsById = useMemo(
    () => new Map(state.participants.map((entry) => [entry.id, entry])),
    [state.participants],
  );
  const isTeamCaptain = Boolean(
    team &&
      participant &&
      deviceId &&
      canDeviceSubmitTeamResult(team, deviceId),
  );
  const participantSlot =
    team && participant
      ? team.players.find((player) => player.participantId === participant.id)?.slot ?? null
      : null;
  const canEditTeamName = state.stage === "setup";
  const teamNeedsCustomName = Boolean(team && !team.nameIsCustom);
  const teamId = team?.id ?? null;
  const teamDisplayName = team?.name ?? "";
  const teamHasCustomName = team?.nameIsCustom ?? false;
  const completedMatchesCount = visibleTeamMatches.filter(
    (match) => match.status === "completed" || match.bye,
  ).length;
  const pointsOnlyMode = useMemo(
    () => isPointsOnlyMatchFormat(state.config),
    [state.config],
  );
  const pendingMobileResultMatch = pendingMobileResultConfirmation
    ? state.matches.find((match) => match.id === pendingMobileResultConfirmation.matchId) ??
      null
    : null;
  const pendingMobileResultTeamA = pendingMobileResultMatch?.teamAId
    ? state.teams.find((entry) => entry.id === pendingMobileResultMatch.teamAId) ?? null
    : null;
  const pendingMobileResultTeamB = pendingMobileResultMatch?.teamBId
    ? state.teams.find((entry) => entry.id === pendingMobileResultMatch.teamBId) ?? null
    : null;
  const isMobileAdmin = Boolean(deviceId && state.adminDeviceId === deviceId);
  const canShowAdminTab = deviceIdReady && (!state.adminDeviceId || isMobileAdmin);
  const effectiveMobileTab = canShowAdminTab || activeMobileTab !== "admin" ? activeMobileTab : "player";
  const adminExpectedParticipants = state.config.teamCount * 2;
  const adminRegisteredCount = state.participants.length;
  const adminRegistrationComplete = adminRegisteredCount === adminExpectedParticipants;
  const adminCanCreateTeams =
    state.stage === "setup" &&
    adminRegistrationComplete &&
    adminRegisteredCount % 2 === 0;
  const adminTeamsReady =
    state.teams.length === state.config.teamCount &&
    state.teams.every((entry) => isTeamComplete(entry) && entry.confirmed);
  const adminStructure = getTournamentStructure(state.config.teamCount, state.config.format);
  const adminMatches = getCurrentMobileAdminMatches(state);
  const visibleAdminMatches = adminMatches.filter(
    (match) => (match.stage !== "swiss" && match.stage !== "league") || match.revealed,
  );
  const adminRoundComplete =
    adminMatches.length > 0 &&
    adminMatches.every((match) => match.status === "completed" || match.bye);
  const adminNextGroupLabel = getNextMobileAdminGroupLabel(state);
  const adminActiveMatch = adminMatchEditor
    ? state.matches.find((match) => match.id === adminMatchEditor.matchId) ?? null
    : null;
  const adminActiveTeamA = getAdminMatchTeam(state, adminActiveMatch, "teamA");
  const adminActiveTeamB = getAdminMatchTeam(state, adminActiveMatch, "teamB");
  const adminActiveDraft = adminActiveMatch
    ? adminResultDrafts[adminActiveMatch.id] ?? buildMobileResultDraft(adminActiveMatch, null)
    : null;
  const assignedAdminParticipantIds = useMemo(
    () =>
      new Set(
        state.teams.flatMap((entry) =>
          entry.players
            .map((player) => player.participantId)
            .filter((value): value is string => Boolean(value)),
        ),
      ),
    [state.teams],
  );

  useEffect(() => {
    if (!teamId) {
      setTeamNameInput("");
      return;
    }

    setTeamNameInput(teamHasCustomName ? teamDisplayName : "");
  }, [teamDisplayName, teamHasCustomName, teamId]);

  useEffect(() => {
    if (!canShowAdminTab && activeMobileTab === "admin") {
      setActiveMobileTab("player");
    }
  }, [activeMobileTab, canShowAdminTab]);

  async function handleFileChange(file: File | null): Promise<void> {
    if (!file) {
      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      setSelectedFile(null);
      setPreviewUrl(null);
      return;
    }

    try {
      const mirroredFile = await mirrorSelfieFile(file);
      setSelectedFile(mirroredFile);

      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }

      const objectUrl = URL.createObjectURL(mirroredFile);
      previewObjectUrlRef.current = objectUrl;
      setPreviewUrl(objectUrl);
      setFeedback("");
    } catch {
      setSelectedFile(file);

      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
      }

      const fallbackUrl = URL.createObjectURL(file);
      previewObjectUrlRef.current = fallbackUrl;
      setPreviewUrl(fallbackUrl);
      setFeedback("No se ha podido preparar la foto, pero puedes intentar enviarla igualmente.");
    }
  }

  async function refreshState(): Promise<void> {
    const response = await fetch("/api/tournament", { cache: "no-store" });
    const payload = (await response.json()) as TournamentState | { error: string };

    if (!response.ok || "error" in payload) {
      throw new Error("error" in payload ? payload.error : "No se ha podido cargar el torneo.");
    }

    setState(payload);
  }

  async function handleRegister(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!deviceId) {
      setFeedback("Todavía se está inicializando este móvil. Espera un segundo.");
      return;
    }

    if (!name.trim()) {
      setFeedback("El nombre es obligatorio.");
      return;
    }

    if (!selectedFile) {
      setFeedback("La foto es obligatoria.");
      return;
    }

    setIsRegistering(true);
    setFeedback("");

    try {
      const formData = new FormData();
      formData.set("deviceId", deviceId);
      formData.set("name", name.trim());
      formData.set("file", selectedFile);

      const response = await fetch("/api/tournament/register", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json()) as TournamentState | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "No se ha podido completar el registro.");
      }

      setState(payload);
      setSelectedFile(null);
      setFeedback("Registro completado. Este móvil ya queda asociado a tu ficha.");

      if (previewObjectUrlRef.current) {
        URL.revokeObjectURL(previewObjectUrlRef.current);
        previewObjectUrlRef.current = null;
      }
      setPreviewUrl(null);
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsRegistering(false);
    }
  }

  async function handleSendMessage(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!deviceId || !chatInput.trim()) {
      return;
    }

    setIsSendingMessage(true);

    try {
      const response = await fetch("/api/tournament", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "postChatMessage",
          payload: {
            deviceId,
            text: chatInput.trim(),
          },
        }),
      });
      const payload = (await response.json()) as TournamentState | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "No se ha podido mandar el mensaje.");
      }

      setState(payload);
      setChatInput("");
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleSaveTeamName(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!team || !deviceId || !isTeamCaptain) {
      return;
    }

    if (!teamNameInput.trim()) {
      setFeedback("El nombre del equipo es obligatorio.");
      return;
    }

    setIsSavingTeamName(true);

    try {
      const response = await fetch("/api/tournament", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "setTeamCustomName",
          payload: {
            deviceId,
            teamId: team.id,
            name: teamNameInput.trim(),
          },
        }),
      });
      const payload = (await response.json()) as TournamentState | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "No se ha podido guardar el nombre del equipo.");
      }

      setState(payload);
      setFeedback(
        team.nameIsCustom
          ? "Nombre del equipo actualizado."
          : "Nombre del equipo guardado.",
      );
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsSavingTeamName(false);
    }
  }

  function handleMobileResultDraftChange(
    match: Match,
    side: "teamA" | "teamB",
    field: "vacas" | "games" | "points",
    value: string,
  ): void {
    const digits = value.replace(/[^\d]/g, "");
    const nextValue =
      pointsOnlyMode && field === "points" && digits
        ? String(Math.min(Number(digits), state.config.targetPoints))
        : digits;

    setMobileResultDrafts((current) => {
      const existing = current[match.id] ?? buildMobileResultDraft(match, team?.id ?? null);

      return {
        ...current,
        [match.id]: {
          ...existing,
          [side]: {
            ...existing[side],
            [field]: nextValue,
          },
        },
      };
    });
  }

  function handleRequestMobileResultConfirmation(match: Match): void {
    const draft = mobileResultDrafts[match.id] ?? buildMobileResultDraft(match, team?.id ?? null);
    setPendingMobileResultConfirmation({
      matchId: match.id,
      score: mobileDraftToScore(draft, pointsOnlyMode),
    });
  }

  async function handleConfirmMobileResult(): Promise<void> {
    if (!deviceId || !pendingMobileResultConfirmation) {
      return;
    }

    setIsSubmittingMobileResult(true);

    try {
      const response = await fetch("/api/tournament", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "submitMobileMatchResult",
          payload: {
            deviceId,
            matchId: pendingMobileResultConfirmation.matchId,
            score: pendingMobileResultConfirmation.score,
          },
        }),
      });
      const payload = (await response.json()) as TournamentState | { error: string };

      if (!response.ok || "error" in payload) {
        throw new Error(
          "error" in payload ? payload.error : "No se ha podido publicar el resultado.",
        );
      }

      const updatedMatch = payload.matches.find(
        (entry) => entry.id === pendingMobileResultConfirmation.matchId,
      );
      setState(payload);
      setPendingMobileResultConfirmation(null);
      setFeedback(
        updatedMatch?.status === "completed"
          ? "Resultado confirmado por los dos equipos. Mesa cerrada."
          : updatedMatch && getMatchMobileResultConflict(updatedMatch)
            ? "Los resultados no coinciden. Revisad ambas propuestas o esperad resolución manual."
            : "Resultado enviado. Esperando confirmación del otro equipo.",
      );
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsSubmittingMobileResult(false);
    }
  }

  async function postAdminAction(action: string, payload?: unknown): Promise<TournamentState> {
    if (!deviceId) {
      throw new Error("Todavia no se ha identificado este movil.");
    }

    const response = await fetch("/api/tournament", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action,
        payload,
        adminDeviceId: deviceId,
      }),
    });
    const payloadResponse = (await response.json()) as TournamentState | { error: string };

    if (!response.ok || "error" in payloadResponse) {
      throw new Error(
        "error" in payloadResponse ? payloadResponse.error : "No se ha podido ejecutar la accion.",
      );
    }

    setState(payloadResponse);
    return payloadResponse;
  }

  async function runAdminAction(
    action: string,
    payload: unknown,
    successMessage: string,
  ): Promise<void> {
    setIsAdminActionPending(true);
    setFeedback("");

    try {
      await postAdminAction(action, payload);
      setFeedback(successMessage);
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsAdminActionPending(false);
    }
  }

  async function handleClaimMobileAdmin(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!deviceId) {
      setFeedback("Todavia no se ha identificado este movil.");
      return;
    }

    setIsClaimingAdmin(true);
    setFeedback("");

    try {
      await postAdminAction("claimMobileAdmin", {
        deviceId,
        password: adminPassword,
      });
      setAdminPassword("");
      setActiveMobileTab("admin");
      setFeedback("Este movil ya controla el torneo como admin.");
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsClaimingAdmin(false);
    }
  }

  function handleAdminResultDraftChange(
    match: Match,
    side: "teamA" | "teamB",
    field: "vacas" | "games" | "points",
    value: string,
  ): void {
    const digits = value.replace(/[^\d]/g, "");
    const nextValue =
      pointsOnlyMode && field === "points" && digits
        ? String(Math.min(Number(digits), state.config.targetPoints))
        : digits;

    setAdminResultDrafts((current) => {
      const existing = current[match.id] ?? buildMobileResultDraft(match, null);

      return {
        ...current,
        [match.id]: {
          ...existing,
          [side]: {
            ...existing[side],
            [field]: nextValue,
          },
        },
      };
    });
  }

  async function handleAdminSaveMatch(): Promise<void> {
    if (!adminActiveMatch || !adminActiveDraft) {
      return;
    }

    setIsAdminActionPending(true);
    setFeedback("");

    try {
      await postAdminAction("reportMatch", {
        matchId: adminActiveMatch.id,
        score: mobileDraftToScore(adminActiveDraft, pointsOnlyMode),
      });

      if (adminActiveMatch.stage === "final") {
        await postAdminAction("advancePhase");
        setFeedback("Final cerrada. La copa ya puede salir en pantalla.");
      } else {
        setFeedback("Mesa cerrada desde el movil admin.");
      }

      setAdminMatchEditor(null);
    } catch (error) {
      setFeedback((error as Error).message);
    } finally {
      setIsAdminActionPending(false);
    }
  }

  const adminScoreFields = pointsOnlyMode
    ? ([["points", `Puntos max ${state.config.targetPoints}`]] as const)
    : ([
        ["vacas", "Vacas"],
        ["games", "Juegos"],
        ["points", "Puntos"],
      ] as const);
  const adminPanel = !isMobileAdmin ? (
    <section className="rounded-[8px] border border-[var(--accent-border)] bg-[var(--accent-soft)] p-5">
      <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
        Acceso admin
      </p>
      <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
        Controlar torneo desde este movil
      </h2>
      <form className="mt-4 space-y-3" onSubmit={(event) => void handleClaimMobileAdmin(event)}>
        <input
          type="password"
          value={adminPassword}
          onChange={(event) => setAdminPassword(event.target.value)}
          placeholder="Contrasena admin"
          className="input-shell !bg-[var(--surface-inset)] !text-[var(--foreground)]"
        />
        <button
          type="submit"
          disabled={isClaimingAdmin || !adminPassword}
          className="button-primary w-full"
        >
          {isClaimingAdmin ? "Comprobando" : "Entrar como admin"}
        </button>
      </form>
    </section>
  ) : (
    <div className="space-y-4">
      <section className="rounded-[8px] border border-[var(--accent-border)] bg-[var(--accent-soft)] p-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
          Panel admin
        </p>
        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
          {formatStageLabel(state.stage)}
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
          Este movil controla el torneo. La pestana Jugador sigue funcionando igual.
        </p>
      </section>

      {state.stage === "setup" ? (
        <>
          <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                  Registro y parejas
                </p>
                <p className="mt-2 text-sm text-[var(--muted)]">
                  {adminRegisteredCount}/{adminExpectedParticipants} personas · {state.teams.length}/{state.config.teamCount} parejas
                </p>
              </div>
            </div>
            <div className="mt-4 grid gap-2">
              <button
                type="button"
                onClick={() => void runAdminAction("addBotParticipant", undefined, "Bot anadido.")}
                disabled={isAdminActionPending || adminRegisteredCount >= adminExpectedParticipants}
                className="button-secondary w-full"
              >
                Anadir bot
              </button>
              <button
                type="button"
                onClick={() => void runAdminAction("createRandomTeams", undefined, "Parejas sorteadas.")}
                disabled={isAdminActionPending || !adminCanCreateTeams}
                className="button-primary w-full"
              >
                Sortear parejas aleatoriamente
              </button>
              <button
                type="button"
                onClick={() => void runAdminAction("prepareManualTeams", undefined, "Modo manual preparado.")}
                disabled={isAdminActionPending || !adminCanCreateTeams}
                className="button-secondary w-full"
              >
                Formar parejas manualmente
              </button>
              <button
                type="button"
                onClick={() => void runAdminAction("startTournament", undefined, "Torneo iniciado.")}
                disabled={isAdminActionPending || !adminTeamsReady}
                className="button-primary w-full"
              >
                Empezar torneo
              </button>
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Personas
            </p>
            <div className="mt-3 space-y-2">
              {state.participants.map((entry) => (
                <div key={entry.id} className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.42)] p-3">
                  <div className="flex items-center gap-3">
                    <img src={entry.photoUrl} alt={entry.name} className="h-12 w-12 rounded-full object-cover" />
                    <input
                      value={adminParticipantNames[entry.id] ?? entry.name}
                      onChange={(event) =>
                        setAdminParticipantNames((current) => ({
                          ...current,
                          [entry.id]: event.target.value,
                        }))
                      }
                      className="input-shell !bg-[var(--surface-inset)] !py-2 !text-[var(--foreground)]"
                    />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void runAdminAction(
                          "renameParticipantDuringSetup",
                          {
                            participantId: entry.id,
                            name: (adminParticipantNames[entry.id] ?? entry.name).trim(),
                          },
                          "Nombre actualizado.",
                        )
                      }
                      disabled={isAdminActionPending || !(adminParticipantNames[entry.id] ?? entry.name).trim()}
                      className="button-secondary flex-1"
                    >
                      Guardar
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void runAdminAction(
                          "deleteParticipantDuringSetup",
                          { participantId: entry.id },
                          "Persona eliminada.",
                        )
                      }
                      disabled={isAdminActionPending}
                      className="button-secondary flex-1 border-red-500/40 text-red-200"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              ))}
              {state.participants.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted)]">Aun no hay personas registradas.</p>
              ) : null}
            </div>
          </section>

          {state.teams.length > 0 ? (
            <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                Parejas
              </p>
              <div className="mt-3 space-y-3">
                {state.teams.map((entry) => (
                  <div key={entry.id} className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.42)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-[var(--foreground)]">{entry.name}</p>
                      <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--accent)]">
                        {entry.confirmed ? "confirmada" : "pendiente"}
                      </span>
                    </div>
                    {state.teamCreationMode === "manual" ? (
                      <div className="mt-3 space-y-2">
                        {entry.players.map((player) => {
                          const currentParticipantId = player.participantId ?? "";
                          const options = state.participants.filter(
                            (candidate) =>
                              !assignedAdminParticipantIds.has(candidate.id) ||
                              candidate.id === currentParticipantId,
                          );

                          return (
                            <label key={`${entry.id}-${player.slot}`} className="block">
                              <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                                Plaza {player.slot}
                              </span>
                              <select
                                value={currentParticipantId}
                                onChange={(event) =>
                                  void runAdminAction(
                                    "assignParticipantToTeamSlot",
                                    {
                                      teamId: entry.id,
                                      slot: player.slot,
                                      participantId: event.target.value || null,
                                    },
                                    "Plaza actualizada.",
                                  )
                                }
                                disabled={isAdminActionPending}
                                className="input-shell mt-1 w-full !bg-[var(--surface-inset)] !text-[var(--foreground)]"
                              >
                                <option value="">Libre</option>
                                {options.map((candidate) => (
                                  <option key={candidate.id} value={candidate.id}>
                                    {candidate.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          );
                        })}
                        <button
                          type="button"
                          onClick={() =>
                            void runAdminAction(
                              "confirmManualTeam",
                              { teamId: entry.id },
                              "Pareja confirmada.",
                            )
                          }
                          disabled={isAdminActionPending || !isTeamComplete(entry) || entry.confirmed}
                          className="button-primary w-full"
                        >
                          Confirmar pareja
                        </button>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm leading-6 text-[var(--muted)]">
                        {entry.players.map((player) => player.name || "Plaza libre").join(" + ")}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </>
      ) : state.stage === "completed" ? (
        <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
            Torneo cerrado
          </p>
          <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
            El torneo ya esta completado. El PC muestra la clasificacion final.
          </p>
        </section>
      ) : (
        <>
          <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Controles de fase
            </p>
            <div className="mt-3 grid gap-2">
              {state.stage === "league" && adminNextGroupLabel ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAdminAction(
                      "revealLeagueRound",
                      undefined,
                      `Ronda ${state.currentSwissRound} sorteada.`,
                    )
                  }
                  disabled={isAdminActionPending}
                  className="button-primary w-full"
                >
                  Sortear ronda {state.currentSwissRound}
                </button>
              ) : null}
              {state.stage === "swiss" && adminNextGroupLabel ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAdminAction(
                      "revealSwissGroup",
                      { bracketLabel: adminNextGroupLabel },
                      `Tramo ${adminNextGroupLabel} sorteado.`,
                    )
                  }
                  disabled={isAdminActionPending}
                  className="button-primary w-full"
                >
                  Sortear {adminNextGroupLabel}
                </button>
              ) : null}
              {state.stage === "swiss" && adminStructure.topCut > 0 ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAdminAction(
                      "forceSemifinalsFromCurrentStandings",
                      undefined,
                      "Semifinales generadas.",
                    )
                  }
                  disabled={isAdminActionPending}
                  className="button-secondary w-full"
                >
                  Semifinales ahora
                </button>
              ) : null}
              {state.stage === "league" ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAdminAction(
                      "forceLeagueFinalsFromCurrentStandings",
                      undefined,
                      "Fases finales generadas.",
                    )
                  }
                  disabled={isAdminActionPending || state.config.teamCount <= 4}
                  className="button-secondary w-full"
                >
                  Fases finales ahora
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void runAdminAction("advancePhase", undefined, "Fase actualizada.")}
                disabled={isAdminActionPending || !adminRoundComplete}
                className="button-primary w-full"
              >
                {state.stage === "swiss" || state.stage === "league"
                  ? "Pasar ronda"
                  : state.stage === "semifinals" || state.stage === "leagueSemifinals"
                    ? "Pasar a final"
                    : "Cerrar torneo"}
              </button>
              {state.stage === "swiss" || state.stage === "league" ? (
                <button
                  type="button"
                  onClick={() =>
                    void runAdminAction("returnToSetup", undefined, "Vuelta al registro.")
                  }
                  disabled={isAdminActionPending}
                  className="button-secondary w-full"
                >
                  Volver al registro
                </button>
              ) : null}
            </div>
          </section>

          <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Mesas
            </p>
            <div className="mt-3 space-y-2">
              {visibleAdminMatches.map((match) => {
                const matchTeamA = getAdminMatchTeam(state, match, "teamA");
                const matchTeamB = getAdminMatchTeam(state, match, "teamB");
                const mobileConflict = getMatchMobileResultConflict(match);
                const canEditMatch =
                  !match.bye &&
                  ((match.stage !== "swiss" && match.stage !== "league") || match.revealed);

                return (
                  <button
                    key={match.id}
                    type="button"
                    onClick={() => {
                      setAdminResultDrafts((current) => ({
                        ...current,
                        [match.id]: current[match.id] ?? buildMobileResultDraft(match, null),
                      }));
                      setAdminMatchEditor({ matchId: match.id });
                    }}
                    disabled={isAdminActionPending || !canEditMatch}
                    className={`w-full rounded-[8px] border p-3 text-left ${
                      mobileConflict
                        ? "border-rose-400/70 bg-rose-500/12"
                        : "border-[var(--stroke)] bg-[rgba(2,4,3,0.42)]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-[var(--foreground)]">
                        {match.bracketLabel} · Mesa {match.table}
                      </p>
                      <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--accent)]">
                        {mobileConflict
                          ? "conflicto"
                          : match.status === "completed"
                            ? "cerrada"
                            : match.revealed ||
                                (match.stage !== "swiss" && match.stage !== "league")
                              ? "pendiente"
                              : "sin sortear"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6 text-[var(--muted)]">
                      {matchTeamA?.name ?? "Equipo A"} vs {matchTeamB?.name ?? "Equipo B"}
                    </p>
                    {match.mobileResultReports?.length ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--muted-soft)]">
                        {match.mobileResultReports.length} reporte(s) movil(es)
                      </p>
                    ) : null}
                  </button>
                );
              })}
              {visibleAdminMatches.length === 0 ? (
                <p className="text-sm leading-6 text-[var(--muted)]">No hay mesas activas.</p>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );

  return (
    <main className="relative min-h-screen overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.055)_0%,transparent_34%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <TournamentWatermark variant="mobile" />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-xl flex-col px-4 py-8">
        <section className="overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] shadow-[0_40px_120px_rgba(0,0,0,0.24)]">
          <div className="border-b border-[var(--stroke)] bg-[linear-gradient(135deg,rgba(124,255,79,0.13),rgba(18,24,19,0.98)_44%,#0b100c)] px-6 py-7 text-[var(--foreground)]">
            {participant ? (
              <div className="mb-5 flex items-center gap-4">
                <div className="h-20 w-20 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)] shadow-[0_12px_30px_rgba(0,0,0,0.24)]">
                  <img
                    src={participant.photoUrl}
                    alt={participant.name}
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                  {formatStageLabel(state.stage)}
                </span>
              </div>
            ) : null}

            <p className="font-mono text-xs uppercase tracking-[0.24em] text-[var(--accent)]">
              {state.config.title}
            </p>
            <h1 className="mt-3 text-3xl font-semibold leading-tight">
              {!deviceIdReady
                ? "Recuperando ficha"
                : participant
                  ? `Hola, ${participant.name}`
                  : "Entra en el torneo"}
            </h1>
            {participantSlot ? (
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.22em] text-[var(--accent)]">
                Integrante {participantSlot}
              </p>
            ) : null}
          </div>

          <div className="space-y-6 px-6 py-7">
            <div
              className={`grid gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-1 ${
                canShowAdminTab ? "grid-cols-3" : "grid-cols-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveMobileTab("player")}
                aria-label="Jugador"
                className={`min-w-0 rounded-[7px] px-1.5 py-2 text-center font-mono text-[8px] font-bold uppercase tracking-normal ${
                  effectiveMobileTab === "player"
                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "text-[var(--muted)]"
                }`}
              >
                Equipo
              </button>
              <button
                type="button"
                onClick={() => setActiveMobileTab("standings")}
                aria-label="Clasificación"
                className={`min-w-0 rounded-[7px] px-1.5 py-2 text-center font-mono text-[8px] font-bold uppercase tracking-normal ${
                  effectiveMobileTab === "standings"
                    ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                    : "text-[var(--muted)]"
                  }`}
              >
                Clasif.
              </button>
              {canShowAdminTab ? (
                <button
                  type="button"
                  onClick={() => setActiveMobileTab("admin")}
                  className={`min-w-0 rounded-[7px] px-1.5 py-2 text-center font-mono text-[8px] font-bold uppercase tracking-normal ${
                    effectiveMobileTab === "admin"
                      ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                      : "text-[var(--muted)]"
                  }`}
                >
                  Admin
                </button>
              ) : null}
            </div>

            {effectiveMobileTab === "admin" ? (
              adminPanel
            ) : effectiveMobileTab === "standings" ? (
              <MobileStandingsPanel state={state} />
            ) : !deviceIdReady ? (
              <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                  Identificando móvil
                </p>
                <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                  Estamos recuperando la ficha guardada en este navegador.
                </p>
              </div>
            ) : !participant ? (
              <>
                <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                    Registro en directo
                  </p>
                  <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                    Registradas {state.participants.length} de {expectedParticipants} personas.
                  </p>
                </div>

                {state.participants.length >= expectedParticipants ? (
                  <div className="rounded-[8px] border border-amber-400/20 bg-amber-400/10 p-4 text-sm leading-6 text-amber-100">
                    El cupo de jugadores ya está completo para este torneo. Si este móvil ya
                    participaba, vuelve a abrir el QR desde el mismo navegador.
                  </div>
                ) : (
                  <form className="space-y-5" onSubmit={(event) => void handleRegister(event)}>
                    <label className="block">
                      <span className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                        Nombre
                      </span>
                      <input
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Escribe tu nombre"
                        className="input-shell mt-2 text-base !bg-[var(--surface-inset)] !text-[var(--foreground)] placeholder:!text-[var(--muted-soft)]"
                      />
                    </label>

                    <div className="block">
                      <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                        Foto obligatoria
                        <InfoHint label="Usa la cámara o elige una imagen. La foto sirve para reconocer a cada jugador durante el torneo." />
                      </span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        capture="user"
                        onChange={(event) =>
                          void handleFileChange(event.target.files?.[0] ?? null)
                        }
                        className="mt-2 block w-full rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3 text-sm text-[var(--muted)] file:mr-4 file:rounded-full file:border-0 file:bg-[var(--accent)] file:px-4 file:py-2 file:text-xs file:font-semibold file:uppercase file:tracking-[0.16em] file:text-[var(--accent-ink)]"
                      />
                    </div>

                    <div className="overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)]">
                      <div className="flex min-h-72 items-center justify-center bg-[linear-gradient(180deg,rgba(124,255,79,0.08),#050806)]">
                        {previewUrl ? (
                          <img
                            src={previewUrl}
                            alt="Previsualización de la foto"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="px-10 text-center text-sm leading-6 text-[var(--muted-soft)]">
                            Sin foto
                          </div>
                        )}
                      </div>
                    </div>

                    <button
                      type="submit"
                      disabled={isRegistering || state.participants.length >= expectedParticipants}
                      className="button-primary w-full"
                    >
                      {isRegistering ? "Guardando ficha..." : "Participar"}
                    </button>
                  </form>
                )}
              </>
            ) : (
              <>
                {team ? (
                  <div className="space-y-4">
                    {canEditTeamName && isTeamCaptain ? (
                      <section className="rounded-[8px] border border-[var(--accent-border)] bg-[linear-gradient(180deg,rgba(124,255,79,0.10),rgba(18,24,19,0.98))] p-5">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                            Nombre del equipo
                          </p>
                          <InfoHint label="Pon un nombre corto para que la mesa no tenga que mostrar siempre los dos nombres completos." />
                        </div>
                        <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                          {teamNeedsCustomName
                            ? "Decidid ahora un nombre corto"
                            : "Puedes cambiar el nombre del equipo"}
                        </h2>

                        <form className="mt-4 flex flex-col gap-3 sm:flex-row" onSubmit={(event) => void handleSaveTeamName(event)}>
                          <input
                            value={teamNameInput}
                            onChange={(event) => setTeamNameInput(event.target.value)}
                            placeholder="Nombre del equipo"
                            className="input-shell !bg-[var(--surface-inset)] !text-[var(--foreground)] placeholder:!text-[var(--muted-soft)]"
                          />
                          <button
                            type="submit"
                            disabled={isSavingTeamName || !teamNameInput.trim()}
                            className="button-primary"
                          >
                            {isSavingTeamName ? "Guardando" : teamNeedsCustomName ? "Guardar nombre" : "Actualizar nombre"}
                          </button>
                        </form>
                      </section>
                    ) : canEditTeamName && teamNeedsCustomName ? (
                      <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                          Nombre pendiente
                        </p>
                        <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                          El nombre del equipo tiene que decidirlo la plaza A desde su móvil, o la plaza B si A no tiene móvil real. En cuanto lo guarde, aquí dejarás de ver el nombre provisional largo.
                        </p>
                      </section>
                    ) : null}

                    <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                            Tu equipo
                          </p>
                          <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                            {team.name}
                          </h2>
                        </div>
                        <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                          {formatStageLabel(state.stage)}
                        </span>
                      </div>

                      <div className="mt-5 grid gap-3 sm:grid-cols-2">
                        {team.players.map((player) => (
                          <div
                            key={`${team.id}-${player.slot}`}
                            className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-3"
                          >
                            <div className="flex items-center gap-3">
                              <div className="h-16 w-16 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
                                {player.photoUrl ? (
                                  <img
                                    src={player.photoUrl}
                                    alt={player.name}
                                    className="h-full w-full object-cover"
                                  />
                                ) : null}
                              </div>
                              <div>
                                <p className="font-semibold text-[var(--foreground)]">{player.name}</p>
                                <p className="text-sm text-[var(--muted-soft)]">Plaza {player.slot}</p>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                            {state.config.format === "league" ? "Puntos liga" : "Balance"}
                          </p>
                          <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                            {state.config.format === "league"
                              ? team.leaguePoints
                              : `${team.wins}-${team.losses}`}
                          </p>
                        </div>
                        <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] px-4 py-3">
                          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                            Partidas cerradas
                          </p>
                          <p className="mt-2 text-base font-semibold text-[var(--foreground)]">
                            {completedMatchesCount}/{visibleTeamMatches.length}
                          </p>
                        </div>
                      </div>
                    </section>

                    {visibleTeamMatches.length > 0 ? (
                      <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                                Recorrido
                              </p>
                              <InfoHint label="Las mesas aparecen en orden real y el marcador se muestra desde tu equipo." />
                            </div>
                          </div>
                          <span className="rounded-full border border-[var(--stroke)] bg-[var(--accent-soft)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                            {completedMatchesCount}/{visibleTeamMatches.length}
                          </span>
                        </div>

                        <div className="mt-5 space-y-3">
                          {visibleTeamMatches.map((match) => {
                            const opponent = getOpponent(match, team, state);
                            const matchTeamA = match.teamAId
                              ? state.teams.find((entry) => entry.id === match.teamAId) ?? null
                              : null;
                            const matchTeamB = match.teamBId
                              ? state.teams.find((entry) => entry.id === match.teamBId) ?? null
                              : null;
                            const perspectiveScore = getPerspectiveScore(match, team.id);
                            const resultLabel = getPerspectiveResultLabel(match, team.id);
                            const mobileConflict = getMatchMobileResultConflict(match);
                            const ownMobileReport = match.mobileResultReports?.find(
                              (report) => report.teamId === team.id,
                            );
                            const canSubmitMobileResult = Boolean(
                              isTeamCaptain &&
                                matchTeamA &&
                                matchTeamB &&
                                !match.bye &&
                                match.revealed &&
                                match.status !== "completed" &&
                                (!ownMobileReport || mobileConflict),
                            );
                            const mobileDraft =
                              mobileResultDrafts[match.id] ??
                              buildMobileResultDraft(match, team.id);
                            const scoreFields = pointsOnlyMode
                              ? ([["points", `Puntos · máx ${state.config.targetPoints}`]] as const)
                              : ([
                                  ["vacas", "Vacas"],
                                  ["games", "Juegos"],
                                  ["points", "Puntos"],
                                ] as const);

                            return (
                              <div
                                key={match.id}
                                className={`rounded-[8px] border px-4 py-4 ${
                                  mobileConflict
                                    ? "border-rose-400/60 bg-rose-500/10"
                                    : "border-[var(--stroke)] bg-[var(--surface-strong)]"
                                }`}
                              >
                                <div className="flex flex-wrap items-center justify-between gap-3">
                                  <p className="text-sm font-semibold text-[var(--foreground)]">
                                    {getMatchHeading(match)}
                                  </p>
                                  <span
                                    className={`rounded-full border px-3 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${
                                      mobileConflict
                                        ? "border-rose-300/40 bg-rose-500/16 text-rose-100"
                                        : "border-[var(--stroke)] bg-[rgba(2,4,3,0.54)] text-[var(--accent)]"
                                    }`}
                                  >
                                    {mobileConflict ? "Revisar resultado" : resultLabel}
                                  </span>
                                </div>

                                <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                                  {match.bye
                                    ? "Descanso automático para esta ronda."
                                    : opponent
                                      ? `Contra ${opponent.name}.`
                                      : "Rival por confirmar."}
                                </p>

                                {perspectiveScore ? (
                                  pointsOnlyMode ? (
                                    <div className="mt-3 rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.46)] px-3 py-2">
                                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                                        Puntos
                                      </p>
                                      <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                                        {perspectiveScore.own.points}-{perspectiveScore.opponent.points}
                                      </p>
                                    </div>
                                  ) : (
                                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                                      <div className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.46)] px-3 py-2">
                                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                                          Vacas
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                                          {perspectiveScore.own.vacas}-{perspectiveScore.opponent.vacas}
                                        </p>
                                      </div>
                                      <div className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.46)] px-3 py-2">
                                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                                          Juegos
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                                          {perspectiveScore.own.games}-{perspectiveScore.opponent.games}
                                        </p>
                                      </div>
                                      <div className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.46)] px-3 py-2">
                                        <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                                          Puntos
                                        </p>
                                        <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
                                          {perspectiveScore.own.points}-{perspectiveScore.opponent.points}
                                        </p>
                                      </div>
                                    </div>
                                  )
                                ) : null}

                                {match.mobileResultReports?.length ? (
                                  <div className="mt-3 grid gap-2">
                                    {match.mobileResultReports.map((report) => {
                                      const reportTeam = state.teams.find(
                                        (entry) => entry.id === report.teamId,
                                      );

                                      return (
                                        <div
                                          key={`${match.id}-${report.teamId}-mobile-report`}
                                          className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.44)] px-3 py-2"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <p className="min-w-0 truncate text-xs font-semibold text-[var(--foreground)]">
                                              {reportTeam?.name ?? "Equipo"}
                                            </p>
                                            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                                              {formatTime(report.submittedAt)}
                                            </span>
                                          </div>
                                          <p className="mt-1 text-xs text-[var(--muted)]">
                                            {report.participantName}:{" "}
                                            <span className="font-semibold text-[var(--foreground)]">
                                              {scoreSummary(report.score, pointsOnlyMode)}
                                            </span>
                                          </p>
                                        </div>
                                      );
                                    })}
                                  </div>
                                ) : null}

                                {canSubmitMobileResult && matchTeamA && matchTeamB ? (
                                  <form
                                    className="mt-4 rounded-[8px] border border-[var(--accent-border)] bg-[rgba(124,255,79,0.08)] p-3"
                                    onSubmit={(event) => {
                                      event.preventDefault();
                                      handleRequestMobileResultConfirmation(match);
                                    }}
                                  >
                                    <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                                      Publicar resultado
                                    </p>
                                    <div className="mt-3 grid gap-3">
                                      {([
                                        ["teamA", matchTeamA],
                                        ["teamB", matchTeamB],
                                      ] as const).map(([side, sideTeam]) => (
                                        <div
                                          key={`${match.id}-${side}-mobile-score`}
                                          className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.44)] p-3"
                                        >
                                          <p className="text-sm font-semibold text-[var(--foreground)]">
                                            {sideTeam.name}
                                          </p>
                                          <div
                                            className={`mt-2 grid gap-2 ${
                                              pointsOnlyMode ? "grid-cols-1" : "grid-cols-3"
                                            }`}
                                          >
                                            {scoreFields.map(([field, label]) => (
                                              <label key={field} className="block">
                                                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                                                  {label}
                                                </span>
                                                <input
                                                  type="text"
                                                  inputMode="numeric"
                                                  pattern="[0-9]*"
                                                  value={mobileDraft[side][field]}
                                                  onChange={(event) =>
                                                    handleMobileResultDraftChange(
                                                      match,
                                                      side,
                                                      field,
                                                      event.target.value,
                                                    )
                                                  }
                                                  maxLength={pointsOnlyMode ? 2 : undefined}
                                                  className="input-shell mt-1 !bg-[var(--surface-inset)] !py-2 text-center text-base font-semibold !text-[var(--foreground)]"
                                                />
                                              </label>
                                            ))}
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    <button
                                      type="submit"
                                      disabled={isSubmittingMobileResult}
                                      className="button-primary mt-3 w-full"
                                    >
                                      {mobileConflict ? "Reenviar resultado" : "Enviar resultado"}
                                    </button>
                                  </form>
                                ) : ownMobileReport &&
                                  !mobileConflict &&
                                  match.status !== "completed" ? (
                                  <div className="mt-4 rounded-[8px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-3 py-2 text-sm leading-6 text-[var(--foreground)]">
                                    Resultado enviado. Esperando confirmación del otro equipo.
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5 text-sm leading-6 text-[var(--muted)]">
                    Tu ficha ya está dentro. Ahora la mesa está formando las parejas; cuando te asignen una,
                    esta pantalla mostrará tu equipo y su estado.
                  </div>
                )}

                <section className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                          Chat
                        </p>
                        <InfoHint label="Mensajes compartidos con los móviles registrados en este torneo." />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void refreshState()}
                      className="button-secondary"
                    >
                      Recargar
                    </button>
                  </div>

                  <div className="mt-4 h-[24rem] space-y-3 overflow-y-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4">
                    {state.chatMessages.length > 0 ? (
                      state.chatMessages.map((message) => {
                        const author = participantsById.get(message.participantId);
                        const isOwn = author?.id === participant.id;

                        return (
                          <div
                            key={message.id}
                            className={`rounded-[8px] px-4 py-3 ${
                              isOwn
                                ? "ml-8 border border-[var(--accent-border)] bg-[var(--accent-soft)]"
                                : "mr-8 border border-[var(--stroke)] bg-[var(--surface-strong)]"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-[var(--foreground)]">
                                {author?.name ?? "Jugador"}
                              </p>
                              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                                {formatTime(message.createdAt)}
                              </span>
                            </div>
                            <p className="mt-2 text-sm leading-6 text-[var(--muted)]">
                              {message.text}
                            </p>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-sm leading-6 text-[var(--muted-soft)]">
                        Todavía no hay mensajes en el chat.
                      </div>
                    )}
                  </div>

                  <form className="mt-4 flex gap-3" onSubmit={(event) => void handleSendMessage(event)}>
                    <input
                      value={chatInput}
                      onChange={(event) => setChatInput(event.target.value)}
                      placeholder="Escribe al resto de jugadores"
                      className="input-shell !bg-[var(--surface-inset)] !text-[var(--foreground)] placeholder:!text-[var(--muted-soft)]"
                    />
                    <button
                      type="submit"
                      disabled={isSendingMessage || !chatInput.trim()}
                      className="button-primary"
                    >
                      {isSendingMessage ? "Enviando" : "Enviar"}
                    </button>
                  </form>
                </section>
              </>
            )}

            {feedback ? (
              <div className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3 text-sm leading-6 text-[var(--foreground)]">
                {feedback}
              </div>
            ) : null}
          </div>
        </section>
      </div>
      {adminActiveMatch && adminActiveTeamA && adminActiveTeamB && adminActiveDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-md overflow-auto rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.44)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                  Cerrar mesa
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
                  {adminActiveMatch.bracketLabel}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setAdminMatchEditor(null)}
                className="button-secondary px-3"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              {([
                ["teamA", adminActiveTeamA],
                ["teamB", adminActiveTeamB],
              ] as const).map(([side, sideTeam]) => (
                <div key={`${adminActiveMatch.id}-${side}-admin-score`} className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.44)] p-3">
                  <p className="text-sm font-semibold text-[var(--foreground)]">
                    {sideTeam.name}
                  </p>
                  <div className={`mt-2 grid gap-2 ${pointsOnlyMode ? "grid-cols-1" : "grid-cols-3"}`}>
                    {adminScoreFields.map(([field, label]) => (
                      <label key={field} className="block">
                        <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                          {label}
                        </span>
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={adminActiveDraft[side][field]}
                          onChange={(event) =>
                            handleAdminResultDraftChange(
                              adminActiveMatch,
                              side,
                              field,
                              event.target.value,
                            )
                          }
                          className="input-shell mt-1 !bg-[var(--surface-inset)] !py-2 text-center text-base font-semibold !text-[var(--foreground)]"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            {getMatchMobileResultConflict(adminActiveMatch) ? (
              <div className="mt-4 rounded-[8px] border border-rose-400/50 bg-rose-500/12 px-3 py-2 text-sm leading-6 text-rose-100">
                Hay conflicto entre reportes moviles. Guarda aqui el marcador final para resolverlo.
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void handleAdminSaveMatch()}
              disabled={isAdminActionPending}
              className="button-primary mt-4 w-full"
            >
              {isAdminActionPending ? "Guardando" : "Guardar resultado final"}
            </button>
          </div>
        </div>
      ) : null}
      {pendingMobileResultConfirmation &&
      pendingMobileResultMatch &&
      pendingMobileResultTeamA &&
      pendingMobileResultTeamB ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(2,4,3,0.86)] px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-5 shadow-[0_30px_120px_rgba(0,0,0,0.44)]">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Confirmar resultado
            </p>
            <h2 className="mt-2 text-2xl font-semibold text-[var(--foreground)]">
              Revisa antes de publicar
            </h2>
            <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
              Esta es la segunda confirmación. Si el otro equipo publica el mismo marcador, la mesa se cerrará automáticamente.
            </p>
            <div className="mt-4 grid gap-2">
              <div className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.44)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {pendingMobileResultTeamA.name}
                </p>
                <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-[var(--accent)]">
                  {pointsOnlyMode
                    ? `${pendingMobileResultConfirmation.score.teamA.points} puntos`
                    : `${pendingMobileResultConfirmation.score.teamA.vacas} vacas · ${pendingMobileResultConfirmation.score.teamA.games} juegos · ${pendingMobileResultConfirmation.score.teamA.points} puntos`}
                </p>
              </div>
              <div className="rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.44)] px-3 py-2">
                <p className="text-sm font-semibold text-[var(--foreground)]">
                  {pendingMobileResultTeamB.name}
                </p>
                <p className="mt-1 font-mono text-xs uppercase tracking-[0.14em] text-[var(--accent)]">
                  {pointsOnlyMode
                    ? `${pendingMobileResultConfirmation.score.teamB.points} puntos`
                    : `${pendingMobileResultConfirmation.score.teamB.vacas} vacas · ${pendingMobileResultConfirmation.score.teamB.games} juegos · ${pendingMobileResultConfirmation.score.teamB.points} puntos`}
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => setPendingMobileResultConfirmation(null)}
                disabled={isSubmittingMobileResult}
                className="button-secondary"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmMobileResult()}
                disabled={isSubmittingMobileResult}
                className="button-primary"
              >
                {isSubmittingMobileResult ? "Publicando" : "Confirmar y publicar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
