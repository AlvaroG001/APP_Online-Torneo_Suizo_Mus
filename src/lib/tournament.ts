import { randomUUID } from "node:crypto";

export const TOP_CUT = 4;
export const DIRECT_SEMIFINAL_THRESHOLD = 4;

export type TournamentStage =
  | "setup"
  | "swiss"
  | "semifinals"
  | "final"
  | "completed";

export type MatchStage = "swiss" | "semifinal" | "final";
export type TeamStatus = "active" | "qualified" | "eliminated";
export type PlayerSlot = "A" | "B";
export type TeamResult = "W" | "L" | "BYE" | null;
export type TeamCreationMode = "pending" | "random" | "manual";
export type TournamentFormat = "swiss_only" | "swiss_top4";

export interface TournamentConfig {
  title: string;
  teamCount: number;
  vacasPerMatch: number;
  gamesPerVaca: number;
  targetPoints: number;
  publicBaseUrl: string;
  format: TournamentFormat;
}

export interface TournamentStructure {
  entryStage: "swiss" | "semifinals" | "final";
  swissRounds: number;
  topCut: number;
  totalRounds: number;
}

export interface Participant {
  id: string;
  deviceId: string;
  name: string;
  photoUrl: string;
  teamId: string | null;
  registeredAt: string;
  updatedAt: string;
}

export interface PlayerProfile {
  id: string;
  participantId: string | null;
  deviceId: string | null;
  slot: PlayerSlot;
  name: string;
  photoUrl: string | null;
}

export interface Team {
  id: string;
  seed: number;
  label: string;
  name: string;
  nameIsCustom: boolean;
  confirmed: boolean;
  players: [PlayerProfile, PlayerProfile];
  wins: number;
  losses: number;
  buchholz: number;
  matchesPlayedSwiss: number;
  vacasWon: number;
  gamesWon: number;
  pointsWon: number;
  byeCount: number;
  opponents: string[];
  status: TeamStatus;
  lastResult: TeamResult;
}

export interface MatchScoreSide {
  vacas: number;
  games: number;
  points: number;
}

export interface MatchScore {
  teamA: MatchScoreSide;
  teamB: MatchScoreSide;
}

export interface MobileResultReport {
  teamId: string;
  deviceId: string;
  participantId: string | null;
  participantName: string;
  score: MatchScore;
  submittedAt: string;
}

export interface Match {
  id: string;
  stage: MatchStage;
  roundIndex: number;
  table: number;
  bracketLabel: string;
  revealed: boolean;
  teamAId: string | null;
  teamBId: string | null;
  status: "pending" | "completed";
  winnerId: string | null;
  loserId: string | null;
  bye: boolean;
  score: MatchScore | null;
  mobileResultReports?: MobileResultReport[];
  marker?: "autoWin" | "qualification" | "elimination";
  topRank?: 1 | 2 | 3 | 4;
}

export interface ChatMessage {
  id: string;
  participantId: string;
  text: string;
  createdAt: string;
}

export interface TournamentState {
  config: TournamentConfig;
  stage: TournamentStage;
  swissRoundsPlanned: number;
  currentSwissRound: number;
  topCut: number;
  participants: Participant[];
  teams: Team[];
  matches: Match[];
  chatMessages: ChatMessage[];
  teamCreationMode: TeamCreationMode;
  championTeamId: string | null;
  runnerUpTeamId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TournamentResetInput {
  title?: string;
  teamCount: number;
  vacasPerMatch: number;
  gamesPerVaca: number;
  targetPoints: number;
  publicBaseUrl?: string;
  format?: TournamentFormat;
}

export interface TeamUpdateInput {
  teamId: string;
  name: string;
  playerAName: string;
  playerBName: string;
}

export interface MatchResultInput {
  matchId: string;
  score: MatchScore;
}

export interface MobileMatchResultInput {
  deviceId: string;
  matchId: string;
  score: MatchScore;
}

export interface ParticipantRegistrationInput {
  deviceId: string;
  name: string;
  photoUrl: string;
}

export interface TeamSlotAssignmentInput {
  teamId: string;
  slot: PlayerSlot;
  participantId: string | null;
}

export interface TeamConfirmationInput {
  teamId: string;
}

export interface ChatMessageInput {
  deviceId: string;
  text: string;
}

export interface TeamNameUpdateInput {
  deviceId: string;
  teamId: string;
  name: string;
}

export interface ParticipantNameUpdateInput {
  participantId: string;
  name: string;
}

export interface ParticipantDeleteInput {
  participantId: string;
}

export function isPointsOnlyMatchFormat(config: TournamentConfig): boolean {
  return (
    config.vacasPerMatch === 1 &&
    config.gamesPerVaca === 1 &&
    (config.targetPoints === 30 || config.targetPoints === 40)
  );
}

const nowIso = () => new Date().toISOString();

function createPlayer(slot: PlayerSlot): PlayerProfile {
  return {
    id: randomUUID(),
    participantId: null,
    deviceId: null,
    slot,
    name: "",
    photoUrl: null,
  };
}

function participantToPlayer(
  participant: Participant,
  slot: PlayerSlot,
): PlayerProfile {
  return {
    id: participant.id,
    participantId: participant.id,
    deviceId: participant.deviceId,
    slot,
    name: participant.name,
    photoUrl: participant.photoUrl,
  };
}

function clonePlayers(
  players: [PlayerProfile, PlayerProfile],
): [PlayerProfile, PlayerProfile] {
  return players.map((player) => ({ ...player })) as [PlayerProfile, PlayerProfile];
}

function createTeam(seed: number): Team {
  return {
    id: randomUUID(),
    seed,
    label: `Equipo ${seed}`,
    name: `Equipo ${seed}`,
    nameIsCustom: false,
    confirmed: false,
    players: [createPlayer("A"), createPlayer("B")],
    wins: 0,
    losses: 0,
    buchholz: 0,
    matchesPlayedSwiss: 0,
    vacasWon: 0,
    gamesWon: 0,
    pointsWon: 0,
    byeCount: 0,
    opponents: [],
    status: "active",
    lastResult: null,
  };
}

function getAutoTeamName(team: Team): string {
  return team.label;
}

function refreshTeamName(
  team: Team,
  options?: {
    forceAuto?: boolean;
  },
): void {
  if (options?.forceAuto) {
    team.nameIsCustom = false;
  }

  if (team.nameIsCustom) {
    return;
  }

  team.name = getAutoTeamName(team);
}

function isTeamConfirmedForMode(team: Team, mode: TeamCreationMode): boolean {
  if (typeof team.confirmed === "boolean") {
    return team.confirmed;
  }

  return mode !== "manual" || isTeamComplete(team);
}

function buildBotAvatar(name: string, index: number): string {
  const palette = [
    ["#20314d", "#4f8cff"],
    ["#153443", "#22c1c3"],
    ["#2b2141", "#8a5cff"],
    ["#3b2b17", "#ff9b45"],
    ["#1f3b2e", "#5fd483"],
  ] as const;
  const [start, end] = palette[index % palette.length];
  const initials = name
    .split(" ")
    .map((chunk) => chunk[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <defs>
        <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${start}" />
          <stop offset="100%" stop-color="${end}" />
        </linearGradient>
      </defs>
      <rect width="256" height="256" rx="128" fill="url(#g)" />
      <circle cx="128" cy="96" r="44" fill="rgba(255,255,255,0.2)" />
      <path d="M64 214c9-36 34-54 64-54s55 18 64 54" fill="rgba(255,255,255,0.18)" />
      <text x="128" y="144" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="44" font-weight="700" fill="white">${initials}</text>
    </svg>
  `)}`;
}

function getNextBotNumber(participants: Participant[]): number {
  const used = participants
    .map((participant) => {
      const match = participant.name.match(/^Bot (\d+)$/i);
      return match ? Number(match[1]) : 0;
    })
    .filter((value) => Number.isFinite(value));

  return (used.length > 0 ? Math.max(...used) : 0) + 1;
}

export function calculateSwissRounds(teamCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(teamCount, 2))));
}

export function getTournamentStructure(
  teamCount: number,
  format: TournamentFormat,
): TournamentStructure {
  if (teamCount <= 2) {
    return {
      entryStage: "final",
      swissRounds: 0,
      topCut: 0,
      totalRounds: 1,
    };
  }

  if (teamCount <= DIRECT_SEMIFINAL_THRESHOLD) {
    return {
      entryStage: "semifinals",
      swissRounds: 0,
      topCut: 0,
      totalRounds: 2,
    };
  }

  const swissRounds = calculateSwissRounds(teamCount);
  const topCut = format === "swiss_top4" ? TOP_CUT : 0;

  return {
    entryStage: "swiss",
    swissRounds,
    topCut,
    totalRounds: swissRounds + (topCut > 0 ? 2 : 0),
  };
}

export function getExpectedParticipantCount(state: TournamentState): number {
  return state.config.teamCount * 2;
}

export function isTeamComplete(team: Team): boolean {
  return team.players.every(
    (player) =>
      Boolean(player.participantId) &&
      player.name.trim().length > 0 &&
      Boolean(player.photoUrl),
  );
}

export function createEmptyTournament(): TournamentState {
  const createdAt = nowIso();
  const format: TournamentFormat = "swiss_top4";
  const structure = getTournamentStructure(10, format);

  return {
    config: {
      title: "Torneo de Mus",
      teamCount: 10,
      vacasPerMatch: 3,
      gamesPerVaca: 3,
      targetPoints: 35,
      publicBaseUrl: "",
      format,
    },
    stage: "setup",
    swissRoundsPlanned: structure.swissRounds,
    currentSwissRound: 0,
    topCut: structure.topCut,
    participants: [],
    teams: [],
    matches: [],
    chatMessages: [],
    teamCreationMode: "pending",
    championTeamId: null,
    runnerUpTeamId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function normalizeBaseUrl(input?: string): string {
  if (!input) {
    return "";
  }

  return input.trim().replace(/\/+$/, "");
}

export function buildTournament(input: TournamentResetInput): TournamentState {
  if (input.teamCount < 2) {
    throw new Error("El torneo necesita al menos 2 parejas.");
  }

  if (input.targetPoints < 30 || input.targetPoints > 40) {
    throw new Error("Los puntos por juego deben estar entre 30 y 40.");
  }

  if (input.vacasPerMatch < 1 || input.gamesPerVaca < 1) {
    throw new Error("Las vacas y los juegos por vaca deben ser mayores que 0.");
  }

  const createdAt = nowIso();
  const title = input.title?.trim() || "Torneo de Mus";
  const format = input.format === "swiss_only" ? "swiss_only" : "swiss_top4";
  const structure = getTournamentStructure(input.teamCount, format);

  return {
    config: {
      title,
      teamCount: input.teamCount,
      vacasPerMatch: input.vacasPerMatch,
      gamesPerVaca: input.gamesPerVaca,
      targetPoints: input.targetPoints,
      publicBaseUrl: normalizeBaseUrl(input.publicBaseUrl),
      format,
    },
    stage: "setup",
    swissRoundsPlanned: structure.swissRounds,
    currentSwissRound: 0,
    topCut: structure.topCut,
    participants: [],
    teams: [],
    matches: [],
    chatMessages: [],
    teamCreationMode: "pending",
    championTeamId: null,
    runnerUpTeamId: null,
    createdAt,
    updatedAt: createdAt,
  };
}

function standingsComparator(a: Team, b: Team): number {
  return (
    b.wins - a.wins ||
    b.buchholz - a.buchholz ||
    b.vacasWon - a.vacasWon ||
    b.gamesWon - a.gamesWon ||
    b.pointsWon - a.pointsWon ||
    a.seed - b.seed
  );
}

function topCutPointsComparator(a: Team, b: Team): number {
  return (
    b.pointsWon - a.pointsWon ||
    b.gamesWon - a.gamesWon ||
    b.vacasWon - a.vacasWon ||
    b.buchholz - a.buchholz ||
    b.wins - a.wins ||
    a.losses - b.losses ||
    a.seed - b.seed
  );
}

function provisionalTopCutComparator(a: Team, b: Team): number {
  return b.wins - a.wins || b.pointsWon - a.pointsWon || a.seed - b.seed;
}

function hasSameProvisionalTopCutScore(a: Team, b: Team): boolean {
  return a.wins === b.wins && a.pointsWon === b.pointsWon;
}

function pluralize(value: number, singular: string, plural: string): string {
  return value === 1 ? singular : plural;
}

function roundRecordComparator(a: string, b: string): number {
  const [aWins, aLosses] = a.split("-").map(Number);
  const [bWins, bLosses] = b.split("-").map(Number);

  return bWins - aWins || aLosses - bLosses;
}

function parseRecordLabel(label: string): { wins: number; losses: number } {
  const [wins = 0, losses = 0] = label.split("-").map(Number);
  return {
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
  };
}

function scoreComparator(score: MatchScore): number {
  return (
    score.teamA.vacas - score.teamB.vacas ||
    score.teamA.games - score.teamB.games ||
    score.teamA.points - score.teamB.points
  );
}

export function matchScoresAreEqual(a: MatchScore, b: MatchScore): boolean {
  return (
    a.teamA.vacas === b.teamA.vacas &&
    a.teamA.games === b.teamA.games &&
    a.teamA.points === b.teamA.points &&
    a.teamB.vacas === b.teamB.vacas &&
    a.teamB.games === b.teamB.games &&
    a.teamB.points === b.teamB.points
  );
}

function isRealMobilePlayer(player: PlayerProfile): boolean {
  return Boolean(
    player.participantId &&
      player.deviceId &&
      !player.deviceId.trim().toLowerCase().startsWith("bot-"),
  );
}

export function getAuthorizedMobileReporter(team: Team): PlayerProfile | null {
  const playerA = team.players[0];

  if (isRealMobilePlayer(playerA)) {
    return playerA;
  }

  const playerB = team.players[1];

  return isRealMobilePlayer(playerB) ? playerB : null;
}

export function canDeviceSubmitTeamResult(team: Team, deviceId: string): boolean {
  const reporter = getAuthorizedMobileReporter(team);
  return Boolean(reporter?.deviceId && reporter.deviceId === deviceId.trim());
}

export function getMatchMobileResultConflict(match: Match): boolean {
  if (match.status === "completed") {
    return false;
  }

  const { teamAReport, teamBReport } = getMatchMobileResultReportsBySide(match);

  return Boolean(
    teamAReport &&
      teamBReport &&
      !matchScoresAreEqual(teamAReport.score, teamBReport.score),
  );
}

function getMatchMobileResultReportsBySide(match: Match): {
  teamAReport: MobileResultReport | null;
  teamBReport: MobileResultReport | null;
} {
  const reports = match.mobileResultReports ?? [];

  return {
    teamAReport:
      reports.find((report) => report.teamId === match.teamAId) ?? null,
    teamBReport:
      reports.find((report) => report.teamId === match.teamBId) ?? null,
  };
}

function buildMatch(
  stage: MatchStage,
  roundIndex: number,
  table: number,
  teamAId: string,
  teamBId: string,
  bracketLabel: string,
): Match {
  return {
    id: randomUUID(),
    stage,
    roundIndex,
    table,
    bracketLabel,
    revealed: stage !== "swiss",
    teamAId,
    teamBId,
    status: "pending",
    winnerId: null,
    loserId: null,
    bye: false,
    score: null,
  };
}

function buildByeMatch(
  stage: MatchStage,
  roundIndex: number,
  table: number,
  teamId: string,
  bracketLabel: string,
): Match {
  return {
    id: randomUUID(),
    stage,
    roundIndex,
    table,
    bracketLabel,
    revealed: stage !== "swiss",
    teamAId: teamId,
    teamBId: null,
    status: stage === "swiss" ? "pending" : "completed",
    winnerId: stage === "swiss" ? null : teamId,
    loserId: null,
    bye: true,
    score: null,
  };
}

function buildAutoWinMarker(
  roundIndex: number,
  table: number,
  teamId: string,
  bracketLabel: string,
): Match {
  return {
    id: randomUUID(),
    stage: "swiss",
    roundIndex,
    table,
    bracketLabel,
    revealed: false,
    teamAId: teamId,
    teamBId: null,
    status: "pending",
    winnerId: null,
    loserId: null,
    bye: true,
    score: null,
    marker: "autoWin",
  };
}

function buildQualificationMarker(
  roundIndex: number,
  table: number,
  teamId: string,
  bracketLabel: string,
  topRank: 1 | 2 | 3 | 4,
): Match {
  return {
    id: randomUUID(),
    stage: "swiss",
    roundIndex,
    table,
    bracketLabel,
    revealed: true,
    teamAId: teamId,
    teamBId: null,
    status: "completed",
    winnerId: teamId,
    loserId: null,
    bye: true,
    score: null,
    marker: "qualification",
    topRank,
  };
}

function buildEliminationMarker(
  roundIndex: number,
  table: number,
  teamId: string,
  bracketLabel: string,
): Match {
  return {
    id: randomUUID(),
    stage: "swiss",
    roundIndex,
    table,
    bracketLabel,
    revealed: true,
    teamAId: teamId,
    teamBId: null,
    status: "completed",
    winnerId: null,
    loserId: teamId,
    bye: true,
    score: null,
    marker: "elimination",
  };
}

function buildOpponentsHistory(matches: Match[]): Map<string, Set<string>> {
  const history = new Map<string, Set<string>>();

  for (const match of matches) {
    if (!match.teamAId || !match.teamBId || match.bye) {
      continue;
    }

    if (!history.has(match.teamAId)) {
      history.set(match.teamAId, new Set());
    }

    if (!history.has(match.teamBId)) {
      history.set(match.teamBId, new Set());
    }

    history.get(match.teamAId)?.add(match.teamBId);
    history.get(match.teamBId)?.add(match.teamAId);
  }

  return history;
}

function hasAlreadyPlayed(
  history: Map<string, Set<string>>,
  teamAId: string,
  teamBId: string,
): boolean {
  return history.get(teamAId)?.has(teamBId) ?? false;
}

function shuffleItems<T>(items: T[]): T[] {
  const clone = [...items];

  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }

  return clone;
}

function getSwissMatches(matches: Match[]): Match[] {
  return matches.filter((match) => match.stage === "swiss" && !match.marker);
}

function getCurrentStageMatches(state: TournamentState): Match[] {
  if (state.stage === "swiss") {
    return state.matches.filter(
      (match) =>
        match.stage === "swiss" &&
        (!match.marker || match.marker === "autoWin") &&
        match.roundIndex === state.currentSwissRound,
    );
  }

  if (state.stage === "semifinals") {
    return state.matches.filter((match) => match.stage === "semifinal");
  }

  if (state.stage === "final") {
    return state.matches.filter((match) => match.stage === "final");
  }

  return [];
}

function isCurrentStageComplete(state: TournamentState): boolean {
  const matches = getCurrentStageMatches(state);
  return matches.length > 0 && matches.every((match) => match.status === "completed");
}

function getCompletedSwissRounds(matches: Match[]): number {
  const swissMatches = getSwissMatches(matches);
  const rounds = new Map<number, Match[]>();

  for (const match of swissMatches) {
    if (!rounds.has(match.roundIndex)) {
      rounds.set(match.roundIndex, []);
    }
    rounds.get(match.roundIndex)?.push(match);
  }

  let completed = 0;
  for (const round of rounds.values()) {
    if (round.every((match) => match.status === "completed")) {
      completed += 1;
    }
  }

  return completed;
}

function getQualifiedTopCutTeams(state: TournamentState): Team[] {
  const qualificationOrder = new Map(
    state.matches
      .filter((match) => match.marker === "qualification" && match.teamAId && match.topRank)
      .map((match) => [match.teamAId as string, match.topRank as 1 | 2 | 3 | 4]),
  );

  return getRankedTeams(state)
    .filter((team) => team.status === "qualified")
    .sort(
      (left, right) =>
        (qualificationOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (qualificationOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        standingsComparator(left, right),
    );
}

function shouldCloseSwissPhase(state: TournamentState, teams: Team[]): boolean {
  if (state.topCut > 0) {
    return teams.filter((team) => team.status === "qualified").length >= state.topCut;
  }

  return getCompletedSwissRounds(state.matches) >= state.swissRoundsPlanned;
}

function cloneState(state: TournamentState): TournamentState {
  return {
    ...state,
    config: { ...state.config },
    participants: state.participants.map((participant) => ({ ...participant })),
    teams: state.teams.map((team) => ({
      ...team,
      nameIsCustom: Boolean(team.nameIsCustom),
      confirmed: isTeamConfirmedForMode(team, state.teamCreationMode),
      players: clonePlayers(team.players),
      opponents: [...team.opponents],
    })),
    matches: state.matches.map((match) => ({
      ...match,
      marker:
        match.marker === "autoWin" ||
        match.marker === "qualification" ||
        match.marker === "elimination"
          ? match.marker
          : undefined,
      topRank:
        match.topRank === 1 ||
        match.topRank === 2 ||
        match.topRank === 3 ||
        match.topRank === 4
          ? match.topRank
          : undefined,
      revealed: match.revealed ?? true,
      score: match.score
        ? {
            teamA: { ...match.score.teamA },
            teamB: { ...match.score.teamB },
          }
        : null,
      mobileResultReports: Array.isArray(match.mobileResultReports)
        ? match.mobileResultReports.map((report) => ({
            ...report,
            score: {
              teamA: { ...report.score.teamA },
              teamB: { ...report.score.teamB },
            },
          }))
        : undefined,
    })),
    chatMessages: state.chatMessages.map((message) => ({ ...message })),
  };
}

function syncParticipantsAndTeams(cloned: TournamentState): {
  participants: Participant[];
  teams: Team[];
} {
  const participants: Participant[] = cloned.participants.map((participant) => ({
    ...participant,
    teamId: null,
  }));
  const participantsById = new Map(participants.map((participant) => [participant.id, participant]));
  const teams = cloned.teams.map((team) => ({
    ...team,
    nameIsCustom: Boolean(team.nameIsCustom),
    confirmed: isTeamConfirmedForMode(team, cloned.teamCreationMode),
    players: clonePlayers(team.players),
  }));

  for (const team of teams) {
    for (const player of team.players) {
      if (!player.participantId) {
        continue;
      }

      const participant = participantsById.get(player.participantId);
      if (!participant) {
        player.participantId = null;
        player.deviceId = null;
        player.name = "";
        player.photoUrl = null;
        continue;
      }

      if (team.confirmed) {
        participant.teamId = team.id;
      }
      player.id = participant.id;
      player.deviceId = participant.deviceId;
      player.name = participant.name;
      player.photoUrl = participant.photoUrl;
    }

    refreshTeamName(team);
  }

  return { participants, teams };
}

function normalizeGeneratedSwissMarkers(matches: Match[]): Match[] {
  const playableGroups = new Map<string, Match[]>();

  for (const match of matches) {
    if (match.stage !== "swiss" || match.marker) {
      continue;
    }

    const groupKey = `${match.roundIndex}:${match.bracketLabel}`;
    playableGroups.set(groupKey, [...(playableGroups.get(groupKey) ?? []), match]);
  }

  return matches.map((match) => {
    if (match.stage !== "swiss" || match.marker !== "elimination" || !match.teamAId) {
      return match;
    }

    const groupKey = `${match.roundIndex}:${match.bracketLabel}`;
    const playableGroup = playableGroups.get(groupKey) ?? [];

    if (playableGroup.length === 0) {
      return match;
    }

    const groupIsRevealed = playableGroup.every((entry) => entry.revealed);

    return {
      ...match,
      revealed: groupIsRevealed,
      status: groupIsRevealed ? "completed" : "pending",
      winnerId: groupIsRevealed ? match.teamAId : null,
      loserId: null,
      marker: "autoWin",
      topRank: undefined,
    };
  });
}

export function refreshTournamentState(state: TournamentState): TournamentState {
  const cloned = cloneState(state);
  cloned.config.format =
    cloned.config.format === "swiss_only" ? "swiss_only" : "swiss_top4";
  const structure = getTournamentStructure(
    cloned.config.teamCount,
    cloned.config.format,
  );
  const plannedRounds = cloned.swissRoundsPlanned;
  cloned.swissRoundsPlanned = Math.max(
    structure.swissRounds,
    plannedRounds || 0,
    cloned.currentSwissRound,
  );
  cloned.topCut = structure.topCut;
  cloned.matches = normalizeGeneratedSwissMarkers(cloned.matches);
  const synced = syncParticipantsAndTeams(cloned);
  const baseTeams = synced.teams.map((team) => ({
    ...team,
    players: clonePlayers(team.players),
    wins: 0,
    losses: 0,
    buchholz: 0,
    matchesPlayedSwiss: 0,
    vacasWon: 0,
    gamesWon: 0,
    pointsWon: 0,
    byeCount: 0,
    opponents: [] as string[],
    status: "active" as TeamStatus,
    lastResult: null as TeamResult,
  }));

  const teamMap = new Map(baseTeams.map((team) => [team.id, team]));
  const qualifiedTeamIds = new Set<string>();
  const eliminatedTeamIds = new Set<string>();

  for (const match of cloned.matches) {
    const teamA = match.teamAId ? teamMap.get(match.teamAId) : undefined;
    const teamB = match.teamBId ? teamMap.get(match.teamBId) : undefined;

    if (match.status !== "completed") {
      continue;
    }

    if (match.marker === "qualification" && match.teamAId) {
      qualifiedTeamIds.add(match.teamAId);
      continue;
    }

    if (match.marker === "elimination" && match.teamAId) {
      eliminatedTeamIds.add(match.teamAId);
      continue;
    }

    if (match.marker === "autoWin" && teamA) {
      if (match.stage === "swiss") {
        teamA.matchesPlayedSwiss += 1;
        teamA.wins += 1;
        teamA.byeCount += 1;
        teamA.lastResult = "BYE";
      }
      continue;
    }

    if (match.stage === "swiss") {
      if (teamA) {
        teamA.matchesPlayedSwiss += 1;
      }
      if (teamB) {
        teamB.matchesPlayedSwiss += 1;
      }
    }

    if (teamA && match.score) {
      teamA.vacasWon += match.score.teamA.vacas;
      teamA.gamesWon += match.score.teamA.games;
      teamA.pointsWon += match.score.teamA.points;
    }

    if (teamB && match.score) {
      teamB.vacasWon += match.score.teamB.vacas;
      teamB.gamesWon += match.score.teamB.games;
      teamB.pointsWon += match.score.teamB.points;
    }

    if (match.bye && teamA) {
      if (match.stage === "swiss") {
        teamA.wins += 1;
        teamA.byeCount += 1;
        teamA.lastResult = "BYE";
      }
      continue;
    }

    if (!match.winnerId || !match.loserId) {
      continue;
    }

    const winner = teamMap.get(match.winnerId);
    const loser = teamMap.get(match.loserId);

    if (winner) {
      winner.wins += 1;
      winner.lastResult = "W";
    }

    if (loser) {
      loser.losses += 1;
      loser.lastResult = "L";
    }

    if (match.stage === "swiss" && winner && loser) {
      winner.opponents.push(loser.id);
      loser.opponents.push(winner.id);
    }
  }

  for (const team of baseTeams) {
    team.buchholz = team.opponents.reduce((sum, opponentId) => {
      const opponent = teamMap.get(opponentId);
      return sum + (opponent?.wins ?? 0);
    }, 0);
  }

  const rankedTeams = [...baseTeams].sort(standingsComparator);

  for (const team of rankedTeams) {
    if (qualifiedTeamIds.has(team.id)) {
      team.status = "qualified";
    }

    if (eliminatedTeamIds.has(team.id)) {
      team.status = "eliminated";
    }
  }

  if (cloned.stage === "swiss") {
    if (structure.topCut > 0 && shouldCloseSwissPhase(cloned, rankedTeams)) {
      rankedTeams.forEach((team) => {
        if (team.status === "active") {
          team.status = "eliminated";
        }
      });
    }
  }

  if (cloned.stage === "semifinals" || cloned.stage === "final" || cloned.stage === "completed") {
    if (structure.topCut > 0) {
      rankedTeams.forEach((team) => {
        if (team.status === "active") {
          team.status = "eliminated";
        }
      });
    }
  }

  return {
    ...cloned,
    participants: synced.participants,
    teams: rankedTeams,
    updatedAt: nowIso(),
  };
}

export function getRankedTeams(state: TournamentState): Team[] {
  return [...state.teams].sort(standingsComparator);
}

export function findParticipantByDeviceId(
  state: TournamentState,
  deviceId: string,
): Participant | null {
  return state.participants.find((participant) => participant.deviceId === deviceId) ?? null;
}

export function setPublicBaseUrl(
  state: TournamentState,
  publicBaseUrl: string,
): TournamentState {
  const cloned = cloneState(state);
  cloned.config.publicBaseUrl = normalizeBaseUrl(publicBaseUrl);
  return refreshTournamentState(cloned);
}

export function updateTeamDetails(
  state: TournamentState,
  input: TeamUpdateInput,
): TournamentState {
  const cloned = cloneState(state);
  const team = cloned.teams.find((entry) => entry.id === input.teamId);

  if (!team) {
    throw new Error("No se ha encontrado el equipo indicado.");
  }

  team.name = input.name.trim() || team.label;
  team.nameIsCustom = true;
  team.players[0].name = input.playerAName.trim();
  team.players[1].name = input.playerBName.trim();

  return refreshTournamentState(cloned);
}

export function setTeamCustomName(
  state: TournamentState,
  input: TeamNameUpdateInput,
): TournamentState {
  const cloned = cloneState(state);
  const team = cloned.teams.find((entry) => entry.id === input.teamId);

  if (!team) {
    throw new Error("No se ha encontrado el equipo indicado.");
  }

  const captainDeviceId = getAuthorizedMobileReporter(team)?.deviceId;

  if (!captainDeviceId) {
    throw new Error("La pareja aún no está completa.");
  }

  if (captainDeviceId !== input.deviceId.trim()) {
    throw new Error(
      "El nombre del equipo solo puede decidirlo la plaza A desde su móvil, o la plaza B si A no tiene móvil real.",
    );
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("El nombre del equipo es obligatorio.");
  }

  team.name = name;
  team.nameIsCustom = true;

  return refreshTournamentState(cloned);
}

export function updatePlayerPhoto(
  state: TournamentState,
  teamId: string,
  slot: PlayerSlot,
  photoUrl: string,
  playerName?: string,
): TournamentState {
  const cloned = cloneState(state);
  const team = cloned.teams.find((entry) => entry.id === teamId);

  if (!team) {
    throw new Error("No se ha encontrado el equipo indicado.");
  }

  const playerIndex = slot === "A" ? 0 : 1;
  team.players[playerIndex].photoUrl = photoUrl;

  if (playerName?.trim()) {
    team.players[playerIndex].name = playerName.trim();
  }

  if (team.players[playerIndex].participantId) {
    const participant = cloned.participants.find(
      (entry) => entry.id === team.players[playerIndex].participantId,
    );

    if (participant) {
      participant.photoUrl = photoUrl;
      if (playerName?.trim()) {
        participant.name = playerName.trim();
      }
      participant.updatedAt = nowIso();
    }
  }

  return refreshTournamentState(cloned);
}

function ensureParticipantRegistrationReady(state: TournamentState): void {
  const expectedCount = getExpectedParticipantCount(state);

  if (state.participants.length !== expectedCount) {
    throw new Error(
      `Deben registrarse exactamente ${expectedCount} personas antes de montar las parejas.`,
    );
  }

  if (state.participants.length % 2 !== 0) {
    throw new Error("Hace falta un número par de personas para crear parejas.");
  }
}

export function registerParticipant(
  state: TournamentState,
  input: ParticipantRegistrationInput,
): TournamentState {
  const deviceId = input.deviceId.trim();
  const name = input.name.trim();
  const photoUrl = input.photoUrl.trim();

  if (!deviceId) {
    throw new Error("Falta identificar el móvil que se está registrando.");
  }

  if (!name) {
    throw new Error("El nombre es obligatorio.");
  }

  if (!photoUrl) {
    throw new Error("La foto es obligatoria.");
  }

  const cloned = cloneState(state);
  const existing = cloned.participants.find(
    (participant) => participant.deviceId === deviceId,
  );

  if (!existing && cloned.participants.length >= getExpectedParticipantCount(cloned)) {
    throw new Error("Ya se ha alcanzado el máximo de personas para este torneo.");
  }

  const timestamp = nowIso();
  const participant =
    existing ??
    ({
      id: randomUUID(),
      deviceId,
      name,
      photoUrl,
      teamId: null,
      registeredAt: timestamp,
      updatedAt: timestamp,
    } satisfies Participant);

  participant.name = name;
  participant.photoUrl = photoUrl;
  participant.updatedAt = timestamp;

  if (!existing) {
    cloned.participants.push(participant);
  }

  for (const team of cloned.teams) {
    for (const player of team.players) {
      if (player.participantId === participant.id) {
        player.name = participant.name;
        player.photoUrl = participant.photoUrl;
        player.deviceId = participant.deviceId;
      }
    }
    refreshTeamName(team);
  }

  return refreshTournamentState(cloned);
}

export function addBotParticipant(state: TournamentState): TournamentState {
  const cloned = cloneState(state);

  if (cloned.participants.length >= getExpectedParticipantCount(cloned)) {
    throw new Error("Ya se ha alcanzado el máximo de personas para este torneo.");
  }

  const botNumber = getNextBotNumber(cloned.participants);
  const name = `Bot ${botNumber}`;
  const timestamp = nowIso();

  cloned.participants.push({
    id: randomUUID(),
    deviceId: `bot-${botNumber}`,
    name,
    photoUrl: buildBotAvatar(name, botNumber - 1),
    teamId: null,
    registeredAt: timestamp,
    updatedAt: timestamp,
  });

  return refreshTournamentState(cloned);
}

export function renameParticipantDuringSetup(
  state: TournamentState,
  input: ParticipantNameUpdateInput,
): TournamentState {
  if (state.stage !== "setup") {
    throw new Error("Los nombres solo se pueden ajustar durante la preparación.");
  }

  const name = input.name.trim();

  if (!name) {
    throw new Error("El nombre no puede quedar vacío.");
  }

  const cloned = cloneState(state);
  const participant = cloned.participants.find(
    (entry) => entry.id === input.participantId,
  );

  if (!participant) {
    throw new Error("No se ha encontrado la persona indicada.");
  }

  participant.name = name;
  participant.updatedAt = nowIso();

  if (participant.deviceId.startsWith("bot-")) {
    const botNumber = Number(participant.deviceId.replace("bot-", ""));
    participant.photoUrl = buildBotAvatar(
      name,
      Number.isFinite(botNumber) ? Math.max(botNumber - 1, 0) : 0,
    );
  }

  return refreshTournamentState(cloned);
}

export function deleteParticipantDuringSetup(
  state: TournamentState,
  input: ParticipantDeleteInput,
): TournamentState {
  if (state.stage !== "setup") {
    throw new Error("Las personas solo se pueden eliminar durante la preparación.");
  }

  const cloned = cloneState(state);
  const participantIndex = cloned.participants.findIndex(
    (entry) => entry.id === input.participantId,
  );
  const participant = cloned.participants[participantIndex];

  if (!participant) {
    throw new Error("No se ha encontrado la persona indicada.");
  }

  cloned.participants.splice(participantIndex, 1);

  for (const team of cloned.teams) {
    let changed = false;
    team.players = team.players.map((player) => {
      if (player.participantId === participant.id) {
        changed = true;
        return createPlayer(player.slot);
      }

      return player;
    }) as [PlayerProfile, PlayerProfile];

    if (changed) {
      team.nameIsCustom = false;
      team.confirmed = false;
      refreshTeamName(team, { forceAuto: true });
    }
  }

  return refreshTournamentState(cloned);
}

export function deleteBotParticipantDuringSetup(
  state: TournamentState,
  input: ParticipantDeleteInput,
): TournamentState {
  return deleteParticipantDuringSetup(state, input);
}

export function createRandomTeams(state: TournamentState): TournamentState {
  if (state.stage !== "setup") {
    throw new Error("Las parejas solo se pueden crear antes de arrancar el torneo.");
  }

  const refreshed = refreshTournamentState(state);
  ensureParticipantRegistrationReady(refreshed);

  const shuffled = shuffleItems(refreshed.participants);
  const teams = Array.from({ length: refreshed.config.teamCount }, (_, index) => {
    const team = createTeam(index + 1);
    const participantA = shuffled[index * 2];
    const participantB = shuffled[index * 2 + 1];

    team.players = [
      participantToPlayer(participantA, "A"),
      participantToPlayer(participantB, "B"),
    ];
    team.confirmed = true;
    refreshTeamName(team);
    return team;
  });

  return refreshTournamentState({
    ...refreshed,
    teams,
    matches: [],
    currentSwissRound: 0,
    championTeamId: null,
    runnerUpTeamId: null,
    teamCreationMode: "random",
  });
}

export function prepareManualTeams(state: TournamentState): TournamentState {
  if (state.stage !== "setup") {
    throw new Error("Las parejas manuales solo se preparan antes de arrancar el torneo.");
  }

  const refreshed = refreshTournamentState(state);
  ensureParticipantRegistrationReady(refreshed);

  const teams = Array.from({ length: refreshed.config.teamCount }, (_, index) =>
    createTeam(index + 1),
  );

  return refreshTournamentState({
    ...refreshed,
    teams,
    matches: [],
    currentSwissRound: 0,
    championTeamId: null,
    runnerUpTeamId: null,
    teamCreationMode: "manual",
  });
}

export function assignParticipantToTeamSlot(
  state: TournamentState,
  input: TeamSlotAssignmentInput,
): TournamentState {
  if (state.teamCreationMode !== "manual") {
    throw new Error("Activa primero el modo manual para asignar las parejas.");
  }

  const cloned = cloneState(state);
  const targetTeam = cloned.teams.find((team) => team.id === input.teamId);

  if (!targetTeam) {
    throw new Error("No se ha encontrado la pareja indicada.");
  }

  const participant = input.participantId
    ? cloned.participants.find((entry) => entry.id === input.participantId) ?? null
    : null;

  if (input.participantId && !participant) {
    throw new Error("No se ha encontrado la persona seleccionada.");
  }

  for (const team of cloned.teams) {
    team.players = team.players.map((player) => {
      if (participant && player.participantId === participant.id) {
        team.nameIsCustom = false;
        team.confirmed = false;
        return createPlayer(player.slot);
      }
      return player;
    }) as [PlayerProfile, PlayerProfile];
    refreshTeamName(team);
  }

  const playerIndex = input.slot === "A" ? 0 : 1;
  targetTeam.nameIsCustom = false;
  targetTeam.confirmed = false;
  targetTeam.players[playerIndex] = participant
    ? participantToPlayer(participant, input.slot)
    : createPlayer(input.slot);
  refreshTeamName(targetTeam, { forceAuto: true });

  return refreshTournamentState(cloned);
}

export function confirmManualTeam(
  state: TournamentState,
  input: TeamConfirmationInput,
): TournamentState {
  if (state.teamCreationMode !== "manual") {
    throw new Error("Solo puedes confirmar parejas en modo manual.");
  }

  const cloned = cloneState(state);
  const targetTeam = cloned.teams.find((team) => team.id === input.teamId);

  if (!targetTeam) {
    throw new Error("No se ha encontrado la pareja indicada.");
  }

  if (!isTeamComplete(targetTeam)) {
    throw new Error("Asigna primero Integrante A e Integrante B.");
  }

  targetTeam.confirmed = true;
  refreshTeamName(targetTeam, { forceAuto: true });

  return refreshTournamentState(cloned);
}

function ensureTeamsReadyForSwiss(state: TournamentState): void {
  if (state.teams.length !== state.config.teamCount) {
    throw new Error("Primero tienes que cerrar todas las parejas del torneo.");
  }

  if (state.teams.some((team) => !isTeamComplete(team))) {
    throw new Error("Todas las parejas deben tener dos personas con nombre y foto.");
  }

  if (state.teams.some((team) => !team.confirmed)) {
    throw new Error("Confirma todas las parejas antes de empezar el torneo.");
  }
}

function createDirectFinal(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  ensureTeamsReadyForSwiss(refreshed);

  const ranked = getRankedTeams(refreshed);

  if (ranked.length < 2) {
    throw new Error("No hay suficientes parejas para jugar una final.");
  }

  const finalMatch = buildMatch("final", 1, 1, ranked[0].id, ranked[1].id, "Final");

  return refreshTournamentState({
    ...refreshed,
    stage: "final",
    currentSwissRound: 0,
    matches: [finalMatch],
  });
}

function createDirectSemifinals(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  ensureTeamsReadyForSwiss(refreshed);

  const ranked = getRankedTeams(refreshed);

  if (ranked.length < 3) {
    throw new Error("No hay suficientes parejas para generar semifinales.");
  }

  const matches =
    ranked.length === 3
      ? [
          buildByeMatch("semifinal", 1, 1, ranked[0].id, "Semifinal 1"),
          buildMatch("semifinal", 1, 2, ranked[1].id, ranked[2].id, "Semifinal 2"),
        ]
      : [
          buildMatch("semifinal", 1, 1, ranked[0].id, ranked[3].id, "Semifinal 1"),
          buildMatch("semifinal", 1, 2, ranked[1].id, ranked[2].id, "Semifinal 2"),
        ];

  return refreshTournamentState({
    ...refreshed,
    stage: "semifinals",
    currentSwissRound: 0,
    matches,
  });
}

function hasStatusMarker(
  matches: Match[],
  teamId: string,
  marker: "autoWin" | "qualification" | "elimination",
): boolean {
  return matches.some((match) => match.marker === marker && match.teamAId === teamId);
}

function nextTopRank(matches: Match[]): 1 | 2 | 3 | 4 | null {
  const used = new Set(
    matches
      .filter((match) => match.marker === "qualification" && match.topRank)
      .map((match) => match.topRank),
  );

  for (const rank of [1, 2, 3, 4] as const) {
    if (!used.has(rank)) {
      return rank;
    }
  }

  return null;
}

function pushQualificationMarker(
  matches: Match[],
  contextMatches: Match[],
  roundIndex: number,
  table: number,
  team: Team,
  bracketLabel: string,
): { matches: Match[]; table: number } {
  if (
    hasStatusMarker(contextMatches, team.id, "qualification") ||
    hasStatusMarker(contextMatches, team.id, "elimination")
  ) {
    return { matches, table };
  }

  const topRank = nextTopRank(contextMatches);
  if (!topRank) {
    return { matches, table };
  }

  return {
    matches: [
      ...matches,
      buildQualificationMarker(roundIndex, table, team.id, bracketLabel, topRank),
    ],
    table: table + 1,
  };
}

function pushEliminationMarker(
  matches: Match[],
  contextMatches: Match[],
  roundIndex: number,
  table: number,
  team: Team,
  bracketLabel: string,
): { matches: Match[]; table: number } {
  if (
    hasStatusMarker(contextMatches, team.id, "qualification") ||
    hasStatusMarker(contextMatches, team.id, "elimination")
  ) {
    return { matches, table };
  }

  return {
    matches: [...matches, buildEliminationMarker(roundIndex, table, team.id, bracketLabel)],
    table: table + 1,
  };
}

function pairTeamsWithinGroup(
  teams: Team[],
  record: string,
  roundIndex: number,
  initialTable: number,
  swissHistory: Map<string, Set<string>>,
): { matches: Match[]; table: number } {
  const pool = shuffleItems(teams);
  const matches: Match[] = [];
  let table = initialTable;

  while (pool.length >= 2) {
    const teamA = pool.shift();
    if (!teamA) {
      break;
    }

    const nonRepeatCandidates = pool
      .map((candidate, index) => ({ candidate, index }))
      .filter(({ candidate }) => !hasAlreadyPlayed(swissHistory, teamA.id, candidate.id));
    const candidatePool =
      nonRepeatCandidates.length > 0
        ? nonRepeatCandidates
        : pool.map((candidate, index) => ({ candidate, index }));
    const randomChoice = candidatePool[Math.floor(Math.random() * candidatePool.length)];
    const opponentIndex = randomChoice?.index ?? 0;
    const [teamB] = pool.splice(opponentIndex, 1);

    matches.push(buildMatch("swiss", roundIndex, table, teamA.id, teamB.id, record));
    table += 1;
  }

  return { matches, table };
}

function createSwissPairings(
  state: TournamentState,
  roundIndex: number,
): Match[] {
  const activeTeams = getRankedTeams(state).filter((team) => team.status === "active");
  const swissHistory = buildOpponentsHistory(getSwissMatches(state.matches));

  if (roundIndex === 1) {
    const pool = shuffleItems(activeTeams);
    const matches: Match[] = [];
    let table = 1;

    for (let index = 0; index < pool.length; index += 2) {
      const teamA = pool[index];
      const teamB = pool[index + 1];

      if (!teamA) {
        continue;
      }

      if (!teamB) {
        matches.push(buildAutoWinMarker(roundIndex, table, teamA.id, "0-0"));
        table += 1;
        continue;
      }

      matches.push(buildMatch("swiss", roundIndex, table, teamA.id, teamB.id, "0-0"));
      table += 1;
    }

    return matches;
  }

  const groups = new Map<string, Team[]>();
  for (const team of activeTeams) {
    const record = `${team.wins}-${team.losses}`;
    if (!groups.has(record)) {
      groups.set(record, []);
    }
    groups.get(record)?.push(team);
  }

  let matches: Match[] = [];
  let table = 1;

  for (const record of [...groups.keys()].sort(roundRecordComparator)) {
    const group = [...(groups.get(record) ?? [])];
    const { losses } = parseRecordLabel(record);
    const nextRank = nextTopRank([...state.matches, ...matches]);
    const remainingTopSlots = nextRank ? TOP_CUT - nextRank + 1 : 0;

    if (group.length === 1) {
      if (losses === 0 || losses === 1) {
        const next = pushQualificationMarker(
          matches,
          [...state.matches, ...matches],
          roundIndex,
          table,
          group[0],
          record,
        );
        matches = next.matches;
        table = next.table;
      } else {
        const next = pushEliminationMarker(
          matches,
          [...state.matches, ...matches],
          roundIndex,
          table,
          group[0],
          record,
        );
        matches = next.matches;
        table = next.table;
      }
      continue;
    }

    if (losses === 1 && group.length <= 3 && group.length !== 2) {
      for (const team of [...group].sort(topCutPointsComparator).slice(0, remainingTopSlots)) {
        const next = pushQualificationMarker(
          matches,
          [...state.matches, ...matches],
          roundIndex,
          table,
          team,
          record,
        );
        matches = next.matches;
        table = next.table;
      }
      continue;
    }

    if (remainingTopSlots === 2 && group.length === 2) {
      const paired = pairTeamsWithinGroup(group, record, roundIndex, table, swissHistory);
      matches = [...matches, ...paired.matches];
      table = paired.table;
      continue;
    }

    const paired = pairTeamsWithinGroup(group, record, roundIndex, table, swissHistory);
    matches = [...matches, ...paired.matches];
    table = paired.table;

    const pairedTeamIds = new Set(
      paired.matches.flatMap((match) => [match.teamAId, match.teamBId]).filter(Boolean),
    );
    const leftovers = group.filter((team) => !pairedTeamIds.has(team.id));
    for (const team of leftovers) {
      matches = [...matches, buildAutoWinMarker(roundIndex, table, team.id, record)];
      table += 1;
    }
  }

  return matches;
}

function addTopCutProgressionMarkers(state: TournamentState): TournamentState {
  if (state.topCut <= 0) {
    return state;
  }

  let matches = [...state.matches];
  let table =
    Math.max(
      0,
      ...matches
        .filter((match) => match.stage === "swiss" && match.roundIndex === state.currentSwissRound)
        .map((match) => match.table),
    ) + 1;
  const refreshed = refreshTournamentState({ ...state, matches });
  const currentMatches = refreshed.matches.filter(
    (match) =>
      match.stage === "swiss" &&
      !match.marker &&
      match.roundIndex === refreshed.currentSwissRound,
  );
  const byRecord = new Map<string, Match[]>();

  for (const match of currentMatches) {
    if (!byRecord.has(match.bracketLabel)) {
      byRecord.set(match.bracketLabel, []);
    }
    byRecord.get(match.bracketLabel)?.push(match);
  }

  for (const record of [...byRecord.keys()].sort(roundRecordComparator)) {
    const groupMatches = byRecord.get(record) ?? [];
    const { losses } = parseRecordLabel(record);

    if (groupMatches.length !== 1) {
      continue;
    }

    const match = groupMatches[0];
    if (match.status !== "completed" || !match.winnerId) {
      continue;
    }

    const winner = refreshed.teams.find((team) => team.id === match.winnerId);
    const loser = match.loserId
      ? refreshed.teams.find((team) => team.id === match.loserId)
      : null;

    if (losses === 0 && winner) {
      const next = pushQualificationMarker(
        matches,
        matches,
        state.currentSwissRound,
        table,
        winner,
        record,
      );
      matches = next.matches;
      table = next.table;
      continue;
    }

    const nextRank = nextTopRank(matches);
    const remainingSlots = nextRank ? TOP_CUT - nextRank + 1 : 0;
    if (remainingSlots === 2 && winner && loser) {
      for (const team of [winner, loser]) {
        const next = pushQualificationMarker(
          matches,
          matches,
          state.currentSwissRound,
          table,
          team,
          record,
        );
        matches = next.matches;
        table = next.table;
      }
    } else if (losses === 1 && winner) {
      const next = pushQualificationMarker(
        matches,
        matches,
        state.currentSwissRound,
        table,
        winner,
        record,
      );
      matches = next.matches;
      table = next.table;
    }
  }

  return matches.length === state.matches.length
    ? state
    : refreshTournamentState({ ...state, matches });
}

export function startTournament(state: TournamentState): TournamentState {
  if (state.stage !== "setup") {
    throw new Error("El torneo ya está iniciado.");
  }

  const refreshed = refreshTournamentState(state);
  ensureTeamsReadyForSwiss(refreshed);
  const structure = getTournamentStructure(
    refreshed.config.teamCount,
    refreshed.config.format,
  );

  if (structure.entryStage === "final") {
    return createDirectFinal(refreshed);
  }

  if (structure.entryStage === "semifinals") {
    return createDirectSemifinals(refreshed);
  }

  const matches = createSwissPairings(refreshed, 1);

  return refreshTournamentState({
    ...refreshed,
    stage: "swiss",
    currentSwissRound: 1,
    matches,
  });
}

export const startSwissPhase = startTournament;

function normalizeMatchScoreForConfig(
  config: TournamentConfig,
  score: MatchScore,
): MatchScore {
  if (!isPointsOnlyMatchFormat(config)) {
    return {
      teamA: { ...score.teamA },
      teamB: { ...score.teamB },
    };
  }

  if (score.teamA.points > config.targetPoints || score.teamB.points > config.targetPoints) {
    throw new Error(
      `En este formato los puntos no pueden superar ${config.targetPoints}.`,
    );
  }

  if (score.teamA.points === score.teamB.points) {
    throw new Error("El resultado no puede quedar empatado.");
  }

  const teamAWins = score.teamA.points > score.teamB.points;
  const winnerPoints = teamAWins ? score.teamA.points : score.teamB.points;

  if (winnerPoints !== config.targetPoints) {
    throw new Error(
      `La pareja ganadora debe llegar exactamente a ${config.targetPoints} puntos.`,
    );
  }

  return {
    teamA: {
      vacas: teamAWins ? 1 : 0,
      games: teamAWins ? 1 : 0,
      points: score.teamA.points,
    },
    teamB: {
      vacas: teamAWins ? 0 : 1,
      games: teamAWins ? 0 : 1,
      points: score.teamB.points,
    },
  };
}

function ensureMatchScore(state: TournamentState, score: MatchScore): MatchScore {
  const normalizedScore = normalizeMatchScoreForConfig(state.config, score);
  const totalGames = state.config.vacasPerMatch * state.config.gamesPerVaca;
  const values = [
    normalizedScore.teamA.vacas,
    normalizedScore.teamA.games,
    normalizedScore.teamA.points,
    normalizedScore.teamB.vacas,
    normalizedScore.teamB.games,
    normalizedScore.teamB.points,
  ];

  if (values.some((value) => Number.isNaN(value) || value < 0)) {
    throw new Error("Todos los valores del marcador deben ser números positivos.");
  }

  if (
    normalizedScore.teamA.vacas + normalizedScore.teamB.vacas !==
    state.config.vacasPerMatch
  ) {
    throw new Error(
      `La suma de vacas debe ser exactamente ${state.config.vacasPerMatch}.`,
    );
  }

  if (normalizedScore.teamA.games + normalizedScore.teamB.games !== totalGames) {
    throw new Error(`La suma de juegos debe ser exactamente ${totalGames}.`);
  }

  if (
    normalizedScore.teamA.games > totalGames ||
    normalizedScore.teamB.games > totalGames
  ) {
    throw new Error("El número de juegos supera el máximo permitido.");
  }

  if (scoreComparator(normalizedScore) === 0) {
    throw new Error(
      "El resultado no puede quedar empatado. Usa puntos totales como desempate.",
    );
  }

  return normalizedScore;
}

function completeMatchWithScore(match: Match, score: MatchScore): void {
  const comparator = scoreComparator(score);
  const teamAWins = comparator > 0;

  match.status = "completed";
  match.revealed = true;
  match.score = {
    teamA: { ...score.teamA },
    teamB: { ...score.teamB },
  };
  match.winnerId = teamAWins ? match.teamAId : match.teamBId;
  match.loserId = teamAWins ? match.teamBId : match.teamAId;
}

export function recordMatchResult(
  state: TournamentState,
  input: MatchResultInput,
): TournamentState {
  const cloned = cloneState(state);
  const match = cloned.matches.find((entry) => entry.id === input.matchId);

  if (!match || !match.teamAId || !match.teamBId) {
    throw new Error("No se ha encontrado el enfrentamiento indicado.");
  }

  if (match.bye) {
    throw new Error("Los byes no necesitan marcador manual.");
  }

  const normalizedScore = ensureMatchScore(cloned, input.score);

  completeMatchWithScore(match, normalizedScore);

  return refreshTournamentState(cloned);
}

export function submitMobileMatchResult(
  state: TournamentState,
  input: MobileMatchResultInput,
): TournamentState {
  const cloned = cloneState(state);

  if (
    cloned.stage !== "swiss" &&
    cloned.stage !== "semifinals" &&
    cloned.stage !== "final"
  ) {
    throw new Error("No hay una mesa activa donde publicar resultados.");
  }

  const match = cloned.matches.find((entry) => entry.id === input.matchId);

  if (!match || !match.teamAId || !match.teamBId) {
    throw new Error("No se ha encontrado el enfrentamiento indicado.");
  }

  if (match.status === "completed") {
    throw new Error("Esta mesa ya está cerrada y no admite cambios desde móvil.");
  }

  if (match.bye) {
    throw new Error("Los descansos automáticos no necesitan resultado.");
  }

  if (match.stage === "swiss" && !match.revealed) {
    throw new Error("Esta mesa todavía no se ha sorteado.");
  }

  const deviceId = input.deviceId.trim();
  const teamsById = new Map(cloned.teams.map((team) => [team.id, team]));
  const teamA = teamsById.get(match.teamAId);
  const teamB = teamsById.get(match.teamBId);
  const reportingTeam = [teamA, teamB].find(
    (team): team is Team => Boolean(team && canDeviceSubmitTeamResult(team, deviceId)),
  );

  if (!reportingTeam) {
    throw new Error(
      "Solo puede publicar el resultado la plaza A de cada pareja, o la plaza B si A no tiene móvil real.",
    );
  }

  const reporter = getAuthorizedMobileReporter(reportingTeam);
  const normalizedScore = ensureMatchScore(cloned, input.score);
  const submittedAt = nowIso();
  const previousReports = (match.mobileResultReports ?? []).filter(
    (report) => report.teamId === match.teamAId || report.teamId === match.teamBId,
  );
  const previousOwnReport = previousReports.find(
    (report) => report.teamId === reportingTeam.id,
  );
  const previousConflict = getMatchMobileResultConflict({
    ...match,
    mobileResultReports: previousReports,
  });

  if (previousOwnReport && !previousConflict) {
    throw new Error(
      "Ya has enviado el resultado. Solo puedes modificarlo si no coincide con el del otro equipo.",
    );
  }

  const nextReport: MobileResultReport = {
    teamId: reportingTeam.id,
    deviceId,
    participantId: reporter?.participantId ?? null,
    participantName: reporter?.name.trim() || reportingTeam.name,
    score: normalizedScore,
    submittedAt,
  };
  match.mobileResultReports = [
    ...previousReports.filter((report) => report.teamId !== reportingTeam.id),
    nextReport,
  ];

  const { teamAReport, teamBReport } = getMatchMobileResultReportsBySide(match);
  const teamAReporter = teamA ? getAuthorizedMobileReporter(teamA) : null;
  const teamBReporter = teamB ? getAuthorizedMobileReporter(teamB) : null;
  const singleReporterScore =
    teamAReporter && !teamBReporter
      ? teamAReport?.score
      : teamBReporter && !teamAReporter
        ? teamBReport?.score
        : null;

  if (singleReporterScore) {
    completeMatchWithScore(match, singleReporterScore);
  } else if (
    teamAReport &&
    teamBReport &&
    matchScoresAreEqual(teamAReport.score, teamBReport.score)
  ) {
    completeMatchWithScore(match, teamAReport.score);
  }

  return refreshTournamentState(cloned);
}

export function revealSwissGroup(
  state: TournamentState,
  bracketLabel: string,
): TournamentState {
  const cloned = cloneState(state);
  const currentRoundMatches = cloned.matches.filter(
    (match) =>
      match.stage === "swiss" &&
      match.roundIndex === cloned.currentSwissRound &&
      match.bracketLabel === bracketLabel,
  );

  if (currentRoundMatches.length === 0) {
    throw new Error("No se ha encontrado ningún tramo pendiente con ese balance.");
  }

  currentRoundMatches.forEach((match) => {
    match.revealed = true;

    if ((match.bye || match.marker === "autoWin") && match.teamAId) {
      match.status = "completed";
      match.winnerId = match.teamAId;
      match.loserId = null;
    }
  });

  return refreshTournamentState(cloned);
}

function createSemifinals(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  const ranked = getQualifiedTopCutTeams(refreshed);

  if (ranked.length < TOP_CUT) {
    throw new Error("No hay suficientes equipos para montar semifinales.");
  }

  const topFour = ranked.slice(0, TOP_CUT);
  const matches = [
    buildMatch("semifinal", 1, 1, topFour[0].id, topFour[3].id, "Semifinal 1"),
    buildMatch("semifinal", 1, 2, topFour[1].id, topFour[2].id, "Semifinal 2"),
  ];

  return refreshTournamentState({
    ...refreshed,
    stage: "semifinals",
    matches: [...refreshed.matches, ...matches],
  });
}

function getProvisionalTopCutTeams(state: TournamentState): Team[] {
  const candidates = getRankedTeams(state)
    .filter((team) => team.status !== "eliminated")
    .sort(provisionalTopCutComparator);

  if (candidates.length < TOP_CUT) {
    throw new Error("No hay al menos 4 parejas disponibles para pasar a semifinales.");
  }

  for (let index = 0; index < TOP_CUT; index += 1) {
    const current = candidates[index];
    const next = candidates[index + 1];

    if (!current || !next || !hasSameProvisionalTopCutScore(current, next)) {
      continue;
    }

    const tiedTeams = candidates.filter((team) =>
      hasSameProvisionalTopCutScore(team, current),
    );
    const tiedNames = tiedTeams.map((team) => team.name).join(", ");
    const winsText = pluralize(current.wins, "victoria", "victorias");
    const reason =
      index === TOP_CUT - 1
        ? "no se puede distinguir qué pareja ocupa el Top 4"
        : `no se puede ordenar el Top ${index + 1} y el Top ${index + 2}`;

    throw new Error(
      `No se puede pasar a semifinales todavía: ${reason}. ${tiedNames} están empatados con ${current.wins} ${winsText} y ${current.pointsWon} puntos totales. Jugad otra ronda o cerrad más resultados para romper el empate.`,
    );
  }

  return candidates.slice(0, TOP_CUT);
}

export function forceSemifinalsFromCurrentStandings(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);

  if (refreshed.stage !== "swiss") {
    throw new Error("Solo se puede saltar a semifinales desde la fase suiza.");
  }

  if (refreshed.config.format !== "swiss_top4") {
    throw new Error("Este salto solo está disponible en formato Suizo + Top 4.");
  }

  const topFour = getProvisionalTopCutTeams(refreshed);
  const swissMatchesWithoutPreviousQualifications = refreshed.matches.filter(
    (match) => !(match.stage === "swiss" && match.marker === "qualification"),
  );
  const qualificationTableStart =
    Math.max(
      0,
      ...swissMatchesWithoutPreviousQualifications
        .filter(
          (match) =>
            match.stage === "swiss" && match.roundIndex === refreshed.currentSwissRound,
        )
        .map((match) => match.table),
    ) + 1;
  const qualificationMarkers = topFour.map((team, index) =>
    buildQualificationMarker(
      refreshed.currentSwissRound || 1,
      qualificationTableStart + index,
      team.id,
      "Corte directo",
      (index + 1) as 1 | 2 | 3 | 4,
    ),
  );
  const semifinalMatches = [
    buildMatch("semifinal", 1, 1, topFour[0].id, topFour[3].id, "Semifinal 1"),
    buildMatch("semifinal", 1, 2, topFour[1].id, topFour[2].id, "Semifinal 2"),
  ];

  return refreshTournamentState({
    ...refreshed,
    stage: "semifinals",
    championTeamId: null,
    runnerUpTeamId: null,
    matches: [
      ...swissMatchesWithoutPreviousQualifications,
      ...qualificationMarkers,
      ...semifinalMatches,
    ],
  });
}

function createFinal(state: TournamentState): TournamentState {
  const semifinalMatches = state.matches.filter(
    (match) => match.stage === "semifinal",
  );

  if (
    semifinalMatches.length !== 2 ||
    semifinalMatches.some((match) => match.status !== "completed" || !match.winnerId)
  ) {
    throw new Error("Las semifinales deben estar completas antes de generar la final.");
  }

  const finalists = semifinalMatches
    .map((match) => match.winnerId)
    .filter(Boolean) as string[];

  const refreshed = refreshTournamentState(state);
  const finalMatch = buildMatch("final", 1, 1, finalists[0], finalists[1], "Final");

  return refreshTournamentState({
    ...refreshed,
    stage: "final",
    matches: [...refreshed.matches, finalMatch],
  });
}

function finalizeTournament(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  const finalMatch = refreshed.matches.find((match) => match.stage === "final");

  if (!finalMatch || finalMatch.status !== "completed") {
    throw new Error("La final todavía no está cerrada.");
  }

  return refreshTournamentState({
    ...refreshed,
    stage: "completed",
    championTeamId: finalMatch.winnerId,
    runnerUpTeamId: finalMatch.loserId,
  });
}

function finalizeSwissClassification(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  const ranked = getRankedTeams(refreshed);

  return refreshTournamentState({
    ...refreshed,
    stage: "completed",
    championTeamId: ranked[0]?.id ?? null,
    runnerUpTeamId: ranked[1]?.id ?? null,
  });
}

export function advanceTournament(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);
  const structure = getTournamentStructure(
    refreshed.config.teamCount,
    refreshed.config.format,
  );

  if (refreshed.stage === "swiss") {
    const progressed = addTopCutProgressionMarkers(refreshed);
    const progressedStructure = getTournamentStructure(
      progressed.config.teamCount,
      progressed.config.format,
    );

    if (
      progressedStructure.topCut > 0 &&
      getQualifiedTopCutTeams(progressed).length >= progressedStructure.topCut
    ) {
      return createSemifinals(progressed);
    }

    if (!isCurrentStageComplete(progressed)) {
      throw new Error("Completa primero todos los enfrentamientos de la ronda actual.");
    }

    if (
      progressed.currentSwissRound >= progressed.swissRoundsPlanned &&
      progressedStructure.topCut <= 0
    ) {
      return finalizeSwissClassification(progressed);
    }

    if (
      progressed.currentSwissRound >= progressed.swissRoundsPlanned &&
      progressedStructure.topCut > 0
    ) {
      progressed.swissRoundsPlanned = progressed.currentSwissRound + 1;
    }

    if (progressed.currentSwissRound >= progressed.swissRoundsPlanned) {
      if (structure.topCut > 0) {
        return createSemifinals(progressed);
      }

      return finalizeSwissClassification(progressed);
    }

    const nextRound = progressed.currentSwissRound + 1;
    const nextMatches = createSwissPairings(progressed, nextRound);

    if (nextMatches.filter((match) => !match.marker).length === 0) {
      const finalProgressed = addTopCutProgressionMarkers(refreshTournamentState({
        ...progressed,
        currentSwissRound: nextRound,
        matches: [...progressed.matches, ...nextMatches],
      }));

      if (
        progressedStructure.topCut > 0 &&
        getQualifiedTopCutTeams(finalProgressed).length >= progressedStructure.topCut
      ) {
        return createSemifinals(finalProgressed);
      }

      throw new Error("No quedan enfrentamientos suficientes para completar el top 4.");
    }

    return refreshTournamentState({
      ...progressed,
      currentSwissRound: nextRound,
      swissRoundsPlanned: Math.max(progressed.swissRoundsPlanned, nextRound),
      matches: [...progressed.matches, ...nextMatches],
    });
  }

  if (refreshed.stage === "semifinals") {
    if (!isCurrentStageComplete(refreshed)) {
      throw new Error("Completa las semifinales antes de avanzar.");
    }

    return createFinal(refreshed);
  }

  if (refreshed.stage === "final") {
    if (!isCurrentStageComplete(refreshed)) {
      throw new Error("Completa la final antes de cerrar el torneo.");
    }

    return finalizeTournament(refreshed);
  }

  throw new Error("No hay ninguna fase pendiente que avanzar.");
}

export function returnToSetupPreparation(state: TournamentState): TournamentState {
  const refreshed = refreshTournamentState(state);

  return refreshTournamentState({
    ...refreshed,
    stage: "setup",
    currentSwissRound: 0,
    championTeamId: null,
    runnerUpTeamId: null,
    matches: [],
  });
}

export function postChatMessage(
  state: TournamentState,
  input: ChatMessageInput,
): TournamentState {
  const deviceId = input.deviceId.trim();
  const text = input.text.trim();

  if (!deviceId) {
    throw new Error("Falta identificar el móvil que envía el mensaje.");
  }

  if (!text) {
    throw new Error("Escribe algo antes de mandar el mensaje.");
  }

  const cloned = cloneState(state);
  const participant = cloned.participants.find(
    (entry) => entry.deviceId === deviceId,
  );

  if (!participant) {
    throw new Error("Este móvil todavía no está registrado en el torneo.");
  }

  cloned.chatMessages.push({
    id: randomUUID(),
    participantId: participant.id,
    text,
    createdAt: nowIso(),
  });

  if (cloned.chatMessages.length > 200) {
    cloned.chatMessages = cloned.chatMessages.slice(-200);
  }

  return refreshTournamentState(cloned);
}

export function getChampionTeam(state: TournamentState): Team | null {
  if (!state.championTeamId) {
    return null;
  }

  return state.teams.find((team) => team.id === state.championTeamId) ?? null;
}
