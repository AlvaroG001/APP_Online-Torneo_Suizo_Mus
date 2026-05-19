"use client";

/* eslint-disable @next/next/no-img-element */

import QRCode from "qrcode";
import { InfoHint } from "@/components/info-hint";
import { TournamentWatermark } from "@/components/tournament-watermark";
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from "react";
import type {
  Match,
  MatchScore,
  LeagueFinalTier,
  Participant,
  PlayerSlot,
  Team,
  TournamentFormat,
  TournamentState,
} from "@/lib/tournament";
import {
  TOP_CUT,
  advanceTournament,
  forceSemifinalsFromCurrentStandings,
  getLeagueFinalTierLabel,
  getLeagueRankedTeams,
  getMatchMobileResultConflict,
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
  leagueLoserBonusEnabled: boolean;
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
  qualifiedTeams: Array<{ team: Team; topRank: 1 | 2 | 3 | 4 }>;
  eliminatedTeams: Team[];
  isEditable: boolean;
}

interface SwissColumn {
  depth: number;
  boxes: SwissColumnBox[];
}

interface TopCutFooterItem {
  team: Team;
  topRank: 1 | 2 | 3 | 4;
}

interface FinalClassificationItem {
  team: Team;
  rank: number;
  topRank: 1 | 2 | 3 | 4 | null;
}

type Screen = "url" | "setup" | "registration" | "swiss" | "league" | "topcut";
type TopCutRevealMode = "advance" | "force";
type PhaseTransitionRevealMode =
  | "swissToSemifinals"
  | "semifinalsToFinal"
  | "leagueToFinals"
  | "leagueSemifinalsToFinals";
type ViewportProfile = {
  width: number;
  height: number;
  density: "compact" | "balanced" | "spacious";
};

interface MatchClosedCelebrationEvent {
  id: string;
  kind: "matchClosed";
  match: Match;
  teamA: Team;
  teamB: Team;
  score: MatchScore;
  winnerId: string;
  pointsOnlyMode: boolean;
}

interface ChampionCelebrationEvent {
  id: string;
  kind: "champion";
  team: Team;
}

type CelebrationEvent = MatchClosedCelebrationEvent | ChampionCelebrationEvent;

interface TopCutRevealState {
  mode: TopCutRevealMode;
  items: TopCutFooterItem[];
}

interface PhaseTransitionRevealState {
  mode: PhaseTransitionRevealMode;
  teams: Team[];
  nextAction?: "advance" | "forceSemifinals" | "forceLeagueFinals" | "none";
}

interface CelebrationAudioController {
  muted: boolean;
  unlocked: boolean;
  unlock: () => void;
  toggleMuted: () => void;
  playMatchWin: () => void;
  playTopCutReveal: () => void;
  playFinalReveal: () => void;
  playShuffleTick: () => void;
  playChampion: () => void;
}

interface CelebrationTone {
  frequency: number;
  offset: number;
  duration: number;
  gain?: number;
  type?: OscillatorType;
}

interface CelebrationHit extends CelebrationTone {
  dropTo?: number;
}

function subscribeToNothing(): () => void {
  return () => {};
}

const DEFAULT_VIEWPORT_PROFILE = {
  width: 1920,
  height: 1080,
  density: "balanced",
} satisfies ViewportProfile;

const CELEBRATION_SESSION_KEY = "mus-tournament-celebrations-v1";
const CELEBRATION_AUDIO_SESSION_KEY = "mus-tournament-celebration-audio-v1";
const playedCelebrationAudioIds = new Set<string>();

function claimCelebrationAudio(audioId: string): boolean {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") {
    return false;
  }

  const browserAudioIds =
    typeof window === "undefined"
      ? null
      : ((window as Window & { __musCelebrationAudioIds?: Set<string> })
          .__musCelebrationAudioIds ??= new Set<string>());
  const storedAudioIds = readCelebrationAudioIds();

  if (
    playedCelebrationAudioIds.has(audioId) ||
    browserAudioIds?.has(audioId) ||
    storedAudioIds.has(audioId)
  ) {
    return false;
  }

  playedCelebrationAudioIds.add(audioId);
  browserAudioIds?.add(audioId);
  storedAudioIds.add(audioId);
  writeCelebrationAudioIds(storedAudioIds);
  return true;
}

function readCelebrationAudioIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(CELEBRATION_AUDIO_SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];

    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeCelebrationAudioIds(ids: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(
      CELEBRATION_AUDIO_SESSION_KEY,
      JSON.stringify([...ids].slice(-240)),
    );
  } catch {
    try {
      window.sessionStorage.setItem(
        CELEBRATION_AUDIO_SESSION_KEY,
        JSON.stringify([...ids].slice(-240)),
      );
    } catch {
      // Audio replay prevention is best-effort only.
    }
  }
}

function readSeenCelebrationIds(): Set<string> {
  if (typeof window === "undefined") {
    return new Set();
  }

  try {
    const raw = window.sessionStorage.getItem(CELEBRATION_SESSION_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];

    return Array.isArray(parsed)
      ? new Set(parsed.filter((value): value is string => typeof value === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function writeSeenCelebrationIds(ids: Set<string>): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(
      CELEBRATION_SESSION_KEY,
      JSON.stringify([...ids].slice(-240)),
    );
  } catch {
    // Session storage is a best-effort guard against replaying old animations.
  }
}

function getMatchCelebrationId(match: Match): string | null {
  if (
    match.stage === "final" ||
    match.status !== "completed" ||
    !match.winnerId ||
    match.bye ||
    match.marker
  ) {
    return null;
  }

  return `match:${match.id}:${match.winnerId}`;
}

function getChampionCelebrationId(state: TournamentState): string | null {
  return state.stage === "completed" && state.championTeamId
    ? `champion:${state.championTeamId}`
    : null;
}

function getExistingCelebrationIds(state: TournamentState): string[] {
  const ids = state.matches
    .map((match) => getMatchCelebrationId(match))
    .filter((id): id is string => Boolean(id));
  const championId = getChampionCelebrationId(state);

  return championId ? [...ids, championId] : ids;
}

function buildMatchClosedCelebrationEvent(
  state: TournamentState,
  match: Match,
): MatchClosedCelebrationEvent | null {
  const eventId = getMatchCelebrationId(match);
  const teamA = match.teamAId ? state.teams.find((team) => team.id === match.teamAId) : null;
  const teamB = match.teamBId ? state.teams.find((team) => team.id === match.teamBId) : null;

  if (!eventId || !match.winnerId || !match.score || !teamA || !teamB) {
    return null;
  }

  return {
    id: eventId,
    kind: "matchClosed",
    match,
    teamA,
    teamB,
    score: match.score,
    winnerId: match.winnerId,
    pointsOnlyMode: isPointsOnlyMatchFormat(state.config),
  };
}

function buildChampionCelebrationEvent(state: TournamentState): ChampionCelebrationEvent | null {
  const eventId = getChampionCelebrationId(state);
  const team = state.championTeamId
    ? state.teams.find((entry) => entry.id === state.championTeamId)
    : null;

  if (!eventId || !team) {
    return null;
  }

  return {
    id: eventId,
    kind: "champion",
    team,
  };
}

function getNewCelebrationEvents(
  previousState: TournamentState,
  nextState: TournamentState,
  seenIds: Set<string>,
): CelebrationEvent[] {
  const previousMatchesById = new Map(previousState.matches.map((match) => [match.id, match]));
  const events: CelebrationEvent[] = [];

  for (const match of nextState.matches) {
    const eventId = getMatchCelebrationId(match);
    const previousMatch = previousMatchesById.get(match.id);

    if (
      eventId &&
      previousMatch?.status !== "completed" &&
      !seenIds.has(eventId)
    ) {
      const event = buildMatchClosedCelebrationEvent(nextState, match);

      if (event) {
        events.push(event);
      }
    }
  }

  const championEventId = getChampionCelebrationId(nextState);
  if (
    championEventId &&
    previousState.championTeamId !== nextState.championTeamId &&
    !seenIds.has(championEventId)
  ) {
    const event = buildChampionCelebrationEvent(nextState);

    if (event) {
      events.push(event);
    }
  }

  return events;
}

function getViewportProfileSnapshot(): ViewportProfile {
  if (typeof window === "undefined") {
    return DEFAULT_VIEWPORT_PROFILE;
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

function useViewportProfile(): ViewportProfile {
  const [profile, setProfile] = useState<ViewportProfile>(DEFAULT_VIEWPORT_PROFILE);

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

function useElementHeight<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") {
      return;
    }

    let animationFrame = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        setHeight(Math.round(entry.contentRect.height));
      });
    });

    observer.observe(element);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      observer.disconnect();
    };
  }, []);

  return [ref, height];
}

function useCelebrationAudio(): CelebrationAudioController {
  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledSourcesRef = useRef<AudioScheduledSourceNode[]>([]);
  const [muted, setMuted] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const getAudioContext = useCallback((): AudioContext | null => {
    if (typeof window === "undefined" || muted) {
      return null;
    }

    const AudioContextCtor =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!AudioContextCtor) {
      return null;
    }

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextCtor();
    }

    return audioContextRef.current;
  }, [muted]);

  const unlock = useCallback((): void => {
    const context = getAudioContext();

    if (!context) {
      return;
    }

    void context.resume().then(() => {
      setUnlocked(true);
    });
  }, [getAudioContext]);

  const stopScheduledAudio = useCallback((): void => {
    const scheduledSources = scheduledSourcesRef.current;
    scheduledSourcesRef.current = [];

    for (const source of scheduledSources) {
      try {
        source.stop();
      } catch {
        // Source may have already ended.
      }

      try {
        source.disconnect();
      } catch {
        // Some browsers throw when a node is already disconnected.
      }
    }
  }, []);

  const playAudioPattern = useCallback(({
    tones = [],
    hits = [],
  }: {
    tones?: CelebrationTone[];
    hits?: CelebrationHit[];
  }): void => {
    const context = getAudioContext();

    if (!context) {
      return;
    }

    void context.resume().then(() => {
      setUnlocked(true);
      stopScheduledAudio();
      const startTime = context.currentTime + 0.02;
      const scheduledSources: AudioScheduledSourceNode[] = [];

      for (const tone of tones) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const toneStart = startTime + tone.offset;
        oscillator.type = tone.type ?? "triangle";
        oscillator.frequency.setValueAtTime(tone.frequency, toneStart);
        gain.gain.setValueAtTime(0.0001, toneStart);
        gain.gain.exponentialRampToValueAtTime(tone.gain ?? 0.055, toneStart + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, toneStart + tone.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(toneStart);
        oscillator.stop(toneStart + tone.duration + 0.02);
        scheduledSources.push(oscillator);
      }

      for (const hit of hits) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const hitStart = startTime + hit.offset;
        oscillator.type = hit.type ?? "square";
        oscillator.frequency.setValueAtTime(hit.frequency, hitStart);
        oscillator.frequency.exponentialRampToValueAtTime(
          hit.dropTo ?? Math.max(40, hit.frequency * 0.46),
          hitStart + hit.duration,
        );
        gain.gain.setValueAtTime(0.0001, hitStart);
        gain.gain.exponentialRampToValueAtTime(hit.gain ?? 0.035, hitStart + 0.006);
        gain.gain.exponentialRampToValueAtTime(0.0001, hitStart + hit.duration);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(hitStart);
        oscillator.stop(hitStart + hit.duration + 0.02);
        scheduledSources.push(oscillator);
      }

      scheduledSourcesRef.current = scheduledSources;
    });
  }, [getAudioContext, stopScheduledAudio]);

  const toggleMuted = useCallback(() => {
    stopScheduledAudio();
    setMuted((current) => !current);
  }, [stopScheduledAudio]);

  useEffect(() => () => stopScheduledAudio(), [stopScheduledAudio]);
  const playMatchWin = useCallback(
    () => {
      playAudioPattern({
        hits: [
          ...Array.from({ length: 16 }, (_, index) => ({
            offset: index * 0.18,
            duration: 0.045,
            frequency: index % 4 === 0 ? 120 : 820,
            gain: index % 4 === 0 ? 0.052 : 0.022,
            type: index % 4 === 0 ? ("sine" as OscillatorType) : ("square" as OscillatorType),
          })),
          ...Array.from({ length: 10 }, (_, index) => ({
            offset: 0.09 + index * 0.27,
            duration: 0.026,
            frequency: 1280 + index * 24,
            gain: 0.018,
            type: "triangle" as OscillatorType,
          })),
        ],
        tones: [
          { frequency: 392, offset: 0, duration: 0.12, gain: 0.04, type: "triangle" },
          { frequency: 493.88, offset: 0.18, duration: 0.12, gain: 0.04, type: "triangle" },
          { frequency: 587.33, offset: 0.36, duration: 0.14, gain: 0.044, type: "triangle" },
          { frequency: 783.99, offset: 0.6, duration: 0.18, gain: 0.05, type: "triangle" },
          { frequency: 659.25, offset: 0.92, duration: 0.14, gain: 0.042, type: "triangle" },
          { frequency: 783.99, offset: 1.1, duration: 0.16, gain: 0.046, type: "triangle" },
          { frequency: 987.77, offset: 1.34, duration: 0.2, gain: 0.054, type: "triangle" },
          { frequency: 1174.66, offset: 1.68, duration: 0.54, gain: 0.05, type: "sine" },
          { frequency: 293.66, offset: 0, duration: 3.2, gain: 0.016, type: "sine" },
          { frequency: 440, offset: 0, duration: 3.2, gain: 0.014, type: "sine" },
        ],
      });
    },
    [playAudioPattern],
  );
  const playTopCutReveal = useCallback(
    () =>
      playAudioPattern({
        hits: Array.from({ length: 30 }, (_, index) => ({
          offset: index * 0.095,
          duration: index % 6 === 0 ? 0.055 : 0.026,
          frequency: index % 6 === 0 ? 128 : 760 + (index % 5) * 80,
          gain: index % 6 === 0 ? 0.05 : 0.018,
          type: index % 6 === 0 ? ("sine" as OscillatorType) : ("square" as OscillatorType),
        })),
        tones: [
          { frequency: 196, offset: 0, duration: 4.4, type: "sine", gain: 0.014 },
          { frequency: 392, offset: 0.08, duration: 0.12, type: "square", gain: 0.03 },
          { frequency: 493.88, offset: 0.28, duration: 0.12, type: "square", gain: 0.032 },
          { frequency: 587.33, offset: 0.48, duration: 0.12, type: "square", gain: 0.034 },
          { frequency: 783.99, offset: 0.72, duration: 0.16, gain: 0.046 },
          { frequency: 587.33, offset: 1.06, duration: 0.1, type: "square", gain: 0.03 },
          { frequency: 783.99, offset: 1.22, duration: 0.1, type: "square", gain: 0.032 },
          { frequency: 987.77, offset: 1.38, duration: 0.16, gain: 0.048 },
          { frequency: 659.25, offset: 3.55, duration: 0.16, gain: 0.052 },
          { frequency: 783.99, offset: 3.78, duration: 0.16, gain: 0.056 },
          { frequency: 987.77, offset: 4.02, duration: 0.22, gain: 0.064 },
          { frequency: 1318.51, offset: 4.36, duration: 0.75, gain: 0.064 },
        ],
      }),
    [playAudioPattern],
  );
  const playFinalReveal = useCallback(
    () =>
      playAudioPattern({
        hits: Array.from({ length: 12 }, (_, index) => ({
          offset: 0.18 + index * 0.18,
          duration: 0.04,
          frequency: 170 + (index % 3) * 38,
          gain: 0.03,
          type: "triangle" as OscillatorType,
        })),
        tones: [
          { frequency: 261.63, offset: 0, duration: 2.8, gain: 0.018, type: "sine" },
          { frequency: 392, offset: 0.08, duration: 0.34, gain: 0.052, type: "sawtooth" },
          { frequency: 523.25, offset: 0.08, duration: 0.34, gain: 0.04, type: "sawtooth" },
          { frequency: 392, offset: 0.58, duration: 0.34, gain: 0.052, type: "sawtooth" },
          { frequency: 587.33, offset: 0.58, duration: 0.34, gain: 0.042, type: "sawtooth" },
          { frequency: 440, offset: 1.1, duration: 0.28, gain: 0.054, type: "sawtooth" },
          { frequency: 659.25, offset: 1.1, duration: 0.28, gain: 0.046, type: "sawtooth" },
          { frequency: 523.25, offset: 1.58, duration: 0.32, gain: 0.06, type: "sawtooth" },
          { frequency: 783.99, offset: 1.58, duration: 0.32, gain: 0.05, type: "sawtooth" },
          { frequency: 1046.5, offset: 2.14, duration: 0.9, gain: 0.06, type: "triangle" },
        ],
      }),
    [playAudioPattern],
  );
  const playShuffleTick = useCallback(
    () =>
      playAudioPattern({
        tones: [{ frequency: 880, offset: 0, duration: 0.035, type: "square", gain: 0.026 }],
      }),
    [playAudioPattern],
  );
  const playChampion = useCallback(
    () => {
      playAudioPattern({
        hits: [
          ...[0, 0.72, 1.44, 2.34, 3.24, 4.34, 5.44, 6.68, 7.92].map((offset, index) => ({
            offset,
            duration: index < 3 ? 0.09 : 0.13,
            frequency: index % 2 === 0 ? 82.41 : 98,
            gain: 0.052 + index * 0.003,
            type: "sine" as OscillatorType,
          })),
          ...Array.from({ length: 24 }, (_, index) => ({
            offset: 8.35 + index * 0.07,
            duration: 0.038,
            frequency: 1280 + index * 72,
            gain: 0.015 + index * 0.0011,
            type: "triangle" as OscillatorType,
          })),
        ],
        tones: [
          { frequency: 65.41, offset: 0, duration: 11.8, gain: 0.018, type: "sine" },
          { frequency: 98, offset: 0.25, duration: 11.5, gain: 0.015, type: "sine" },
          { frequency: 196, offset: 0.08, duration: 0.42, gain: 0.034, type: "sawtooth" },
          { frequency: 261.63, offset: 0.08, duration: 0.42, gain: 0.036, type: "sawtooth" },
          { frequency: 392, offset: 0.08, duration: 0.42, gain: 0.032, type: "sawtooth" },
          { frequency: 196, offset: 0.78, duration: 0.42, gain: 0.036, type: "sawtooth" },
          { frequency: 261.63, offset: 0.78, duration: 0.42, gain: 0.038, type: "sawtooth" },
          { frequency: 392, offset: 0.78, duration: 0.42, gain: 0.034, type: "sawtooth" },
          { frequency: 261.63, offset: 1.48, duration: 0.62, gain: 0.04, type: "sawtooth" },
          { frequency: 329.63, offset: 1.48, duration: 0.62, gain: 0.038, type: "sawtooth" },
          { frequency: 523.25, offset: 1.48, duration: 0.62, gain: 0.036, type: "sawtooth" },
          { frequency: 392, offset: 2.42, duration: 0.48, gain: 0.046, type: "sawtooth" },
          { frequency: 523.25, offset: 2.42, duration: 0.48, gain: 0.042, type: "sawtooth" },
          { frequency: 783.99, offset: 2.42, duration: 0.48, gain: 0.038, type: "sawtooth" },
          { frequency: 392, offset: 3.08, duration: 0.48, gain: 0.048, type: "sawtooth" },
          { frequency: 523.25, offset: 3.08, duration: 0.48, gain: 0.044, type: "sawtooth" },
          { frequency: 783.99, offset: 3.08, duration: 0.48, gain: 0.04, type: "sawtooth" },
          { frequency: 523.25, offset: 3.82, duration: 0.72, gain: 0.052, type: "sawtooth" },
          { frequency: 659.25, offset: 3.82, duration: 0.72, gain: 0.047, type: "sawtooth" },
          { frequency: 1046.5, offset: 3.82, duration: 0.72, gain: 0.04, type: "sawtooth" },
          { frequency: 783.99, offset: 4.92, duration: 0.7, gain: 0.058, type: "sawtooth" },
          { frequency: 1046.5, offset: 4.92, duration: 0.7, gain: 0.05, type: "sawtooth" },
          { frequency: 1567.98, offset: 4.92, duration: 0.7, gain: 0.042, type: "sawtooth" },
          { frequency: 659.25, offset: 5.95, duration: 0.34, gain: 0.046, type: "sawtooth" },
          { frequency: 783.99, offset: 6.28, duration: 0.34, gain: 0.05, type: "sawtooth" },
          { frequency: 987.77, offset: 6.62, duration: 0.42, gain: 0.054, type: "sawtooth" },
          { frequency: 1318.51, offset: 7.02, duration: 0.58, gain: 0.058, type: "sawtooth" },
          { frequency: 523.25, offset: 7.86, duration: 3.15, gain: 0.052, type: "sawtooth" },
          { frequency: 659.25, offset: 7.86, duration: 3.15, gain: 0.048, type: "sawtooth" },
          { frequency: 783.99, offset: 7.86, duration: 3.15, gain: 0.046, type: "sawtooth" },
          { frequency: 1046.5, offset: 7.86, duration: 3.25, gain: 0.042, type: "triangle" },
          { frequency: 1567.98, offset: 8.34, duration: 2.7, gain: 0.032, type: "triangle" },
        ],
      });
    },
    [playAudioPattern],
  );

  return useMemo(() => ({
    muted,
    unlocked,
    unlock,
    toggleMuted,
    playMatchWin,
    playTopCutReveal,
    playFinalReveal,
    playShuffleTick,
    playChampion,
  }), [
    muted,
    unlocked,
    unlock,
    toggleMuted,
    playMatchWin,
    playTopCutReveal,
    playFinalReveal,
    playShuffleTick,
    playChampion,
  ]);
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
    leagueLoserBonusEnabled: state.config.leagueLoserBonusEnabled !== false,
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

function formatScoreSummary(score: MatchScore, pointsOnlyMode: boolean): string {
  return pointsOnlyMode
    ? `${score.teamA.points}-${score.teamB.points}`
    : `${score.teamA.vacas}-${score.teamB.vacas} vacas · ${score.teamA.games}-${score.teamB.games} juegos · ${score.teamA.points}-${score.teamB.points} puntos`;
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

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function getBaseUrlHostname(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return "";
  }
}

function needsNetworkUrlRefresh(publicBaseUrl: string, networkBaseUrls: string[]): boolean {
  const normalizedBaseUrl = normalizeBaseUrlInput(publicBaseUrl);
  const suggestedNetworkUrl = networkBaseUrls[0] ?? "";

  if (!normalizedBaseUrl) {
    return true;
  }

  if (!suggestedNetworkUrl) {
    return false;
  }

  const hostname = getBaseUrlHostname(normalizedBaseUrl);
  return (
    isLocalhostLike(normalizedBaseUrl) ||
    (isPrivateIpv4(hostname) && !networkBaseUrls.includes(normalizedBaseUrl))
  );
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
      match.stage === "swiss" &&
      (!match.marker || match.marker === "autoWin") &&
      match.roundIndex === state.currentSwissRound,
  );
}

function getCurrentLeagueMatches(state: TournamentState): Match[] {
  return state.matches.filter(
    (match) =>
      match.stage === "league" && match.roundIndex === state.currentSwissRound,
  );
}

function getCurrentPlayoffMatches(state: TournamentState): Match[] {
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

function getCompletedSemifinalWinners(state: TournamentState): Team[] {
  if (state.stage !== "semifinals" && state.stage !== "leagueSemifinals") {
    return [];
  }

  const teamsById = new Map(state.teams.map((team) => [team.id, team]));

  return getCurrentPlayoffMatches(state)
    .filter((match) => match.status === "completed" && Boolean(match.winnerId))
    .map((match) => teamsById.get(match.winnerId ?? ""))
    .filter((team): team is Team => Boolean(team));
}

function getTopCutFooterItems(state: TournamentState): TopCutFooterItem[] {
  return state.matches
    .filter(
      (match) =>
        match.stage === "swiss" &&
        match.marker === "qualification" &&
        match.teamAId &&
        match.topRank,
    )
    .map((match) => {
      const team = state.teams.find((entry) => entry.id === match.teamAId);
      return team && match.topRank
        ? { team, topRank: match.topRank as 1 | 2 | 3 | 4 }
        : null;
    })
    .filter((item): item is TopCutFooterItem => Boolean(item))
    .toSorted((left, right) => left.topRank - right.topRank);
}

function compareFinalClassificationTeams(left: Team, right: Team): number {
  const leftPhase = left.wins + left.losses;
  const rightPhase = right.wins + right.losses;

  return (
    rightPhase - leftPhase ||
    right.wins - left.wins ||
    left.losses - right.losses ||
    right.pointsWon - left.pointsWon ||
    right.gamesWon - left.gamesWon ||
    right.vacasWon - left.vacasWon ||
    right.buchholz - left.buchholz ||
    left.seed - right.seed
  );
}

function getFinalClassificationItems(
  state: TournamentState,
  topCutItems: TopCutFooterItem[],
): FinalClassificationItem[] {
  const topCutTeamIds = new Set(topCutItems.map((item) => item.team.id));
  const topItems = topCutItems.map(({ team, topRank }) => ({
    team,
    topRank,
    rank: topRank,
  }));
  const restItems = state.teams
    .filter((team) => !topCutTeamIds.has(team.id))
    .toSorted(compareFinalClassificationTeams)
    .map((team, index) => ({
      team,
      topRank: null,
      rank: TOP_CUT + index + 1,
    }));

  return [...topItems, ...restItems];
}

function getSemifinalRevealItems(state: TournamentState): TopCutFooterItem[] {
  const explicitTopCutItems = getTopCutFooterItems(state);

  if (explicitTopCutItems.length >= TOP_CUT) {
    return explicitTopCutItems.slice(0, TOP_CUT);
  }

  return state.teams
    .toSorted(compareFinalClassificationTeams)
    .slice(0, TOP_CUT)
    .map((team, index) => ({
      team,
      topRank: (index + 1) as 1 | 2 | 3 | 4,
    }));
}

function buildSwissColumns(state: TournamentState): SwissColumn[] {
  const swissMatches = state.matches.filter(
    (match) => match.stage === "swiss" && match.marker !== "qualification" && match.marker !== "elimination",
  );
  const matchGroups = new Map<string, Match[]>();
  const standingsGroups = new Map<string, Team[]>();
  const qualifiedGroups = new Map<string, Array<{ team: Team; topRank: 1 | 2 | 3 | 4 }>>();
  const eliminatedGroups = new Map<string, Team[]>();
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
    if (team.status === "qualified") {
      continue;
    }

    if (team.status === "eliminated") {
      if (!eliminatedGroups.has(label)) {
        eliminatedGroups.set(label, []);
      }
      eliminatedGroups.get(label)?.push(team);
      continue;
    }

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

  return Array.from({ length: maxDepth + 1 }, (_, depth) => {
    const boxes = Array.from({ length: depth + 1 }, (_, rowIndex) => {
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
        qualifiedTeams: (qualifiedGroups.get(label) ?? []).toSorted(
          (left, right) => left.topRank - right.topRank,
        ),
        eliminatedTeams: eliminatedGroups.get(label) ?? [],
        isEditable: editableLabels.has(label),
      };
    }).filter(
      (box) =>
        box.matches.length > 0 ||
        box.teams.length > 0 ||
        box.qualifiedTeams.length > 0 ||
        box.eliminatedTeams.length > 0 ||
        box.isEditable,
    );

    return { depth, boxes };
  }).filter((column) => column.boxes.length > 0);
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

  if (stage === "league") {
    return "league";
  }

  if (
    stage === "semifinals" ||
    stage === "final" ||
    stage === "leagueSemifinals" ||
    stage === "leagueFinals" ||
    stage === "completed"
  ) {
    return "topcut";
  }

  return "registration";
}

function formatTournamentFormatLabel(format: TournamentFormat): string {
  if (format === "league") {
    return "Liga";
  }

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

  if (format === "league") {
    const finalDetail =
      teamCount > 4
        ? "Puedes lanzar las fases finales desde la clasificación congelada: Champions, Europa y Conference según número de parejas."
        : "Liga todos contra todos sin fases finales: hace falta más de 4 parejas para jugar Champions.";

    return {
      heading: `${structure.swissRounds} rondas de liga`,
      detail: finalDetail,
      roundsLabel: `${structure.swissRounds} rondas regulares`,
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
  size?: "xxxs" | "xxs" | "xs" | "sm" | "md" | "lg" | "xl";
}) {
  const sizeClasses = {
    xxxs: {
      frame: "h-4 w-4 text-[7px]",
      overlap: "translate-x-[-3px]",
      margin: "-ml-0.5",
    },
    xxs: {
      frame: "h-5 w-5 text-[8px]",
      overlap: "translate-x-[-4px]",
      margin: "-ml-1",
    },
    xs: {
      frame: "h-7 w-7 text-[9px]",
      overlap: "translate-x-[-6px]",
      margin: "-ml-1.5",
    },
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

function seededRatio(seed: string, index: number): number {
  let hash = 2166136261;
  const input = `${seed}:${index}`;

  for (let charIndex = 0; charIndex < input.length; charIndex += 1) {
    hash ^= input.charCodeAt(charIndex);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
}

function ConfettiBurst({ seed, intensity = "regular" }: { seed: string; intensity?: "regular" | "final" }) {
  const count = intensity === "final" ? 110 : 72;

  return (
    <div className="celebration-confetti" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => {
        const x = Math.round(seededRatio(seed, index) * 100);
        const drift = Math.round((seededRatio(seed, index + 97) - 0.5) * 52);
        const delay = seededRatio(seed, index + 191) * 0.65;
        const duration = 2.1 + seededRatio(seed, index + 311) * 1.4;
        const rotation = Math.round(seededRatio(seed, index + 431) * 720);
        const hue = index % 5 === 0 ? "#f8d85a" : index % 3 === 0 ? "#f2f7ee" : "#7cff4f";

        return (
          <span
            key={`${seed}-confetti-${index}`}
            className="celebration-confetti__piece"
            style={
              {
                "--confetti-x": `${x}vw`,
                "--confetti-drift": `${drift}vw`,
                "--confetti-delay": `${delay}s`,
                "--confetti-duration": `${duration}s`,
                "--confetti-rotation": `${rotation}deg`,
                "--confetti-color": hue,
              } as CSSProperties
            }
          />
        );
      })}
    </div>
  );
}

function CrownIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 64 44"
      className={className}
      role="img"
      aria-label="Corona de ganador"
    >
      <path
        d="M6 14l12 10L32 5l14 19 12-10-7 25H13L6 14z"
        fill="currentColor"
      />
      <path
        d="M14 39h36"
        fill="none"
        stroke="rgba(2,4,3,0.55)"
        strokeLinecap="round"
        strokeWidth="4"
      />
    </svg>
  );
}

function CelebrationTeamPortraits({
  team,
  showCrowns,
  tone,
}: {
  team: Team;
  showCrowns: boolean;
  tone: "winner" | "loser";
}) {
  return (
    <div className={`celebration-team-portraits celebration-team-portraits--${tone}`}>
      {team.players.map((player, index) => (
        <div key={`${team.id}-${tone}-${player.slot}`} className="celebration-team-portrait">
          {showCrowns ? <CrownIcon className="celebration-player-crown" /> : null}
          <div className="celebration-team-portrait__photo">
            {player.photoUrl ? (
              <img src={player.photoUrl} alt={playerName(team, index)} />
            ) : (
              <span>{index === 0 ? "A" : "B"}</span>
            )}
          </div>
          <p>{playerName(team, index)}</p>
        </div>
      ))}
    </div>
  );
}

function CelebrationTeamPanel({
  team,
  score,
  isWinner,
  label,
}: {
  team: Team;
  score: number;
  isWinner: boolean;
  label: string;
}) {
  return (
    <article
      className={`celebration-team-panel ${
        isWinner ? "celebration-team-panel--winner" : "celebration-team-panel--loser"
      }`}
    >
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
        {label}
      </p>
      <CelebrationTeamPortraits
        team={team}
        showCrowns={isWinner}
        tone={isWinner ? "winner" : "loser"}
      />
      <h3 className="mt-4 truncate text-center text-4xl font-black tracking-tight text-[var(--foreground)]">
        {team.name}
      </h3>
      <p className="mt-1 truncate text-center text-sm text-[var(--muted)]">
        {playerName(team, 0)} · {playerName(team, 1)}
      </p>
      <div className="mt-5 flex justify-center">
        <span className="celebration-score">{score}</span>
      </div>
    </article>
  );
}

function MatchCelebrationOverlay({
  event,
  audio,
  onDone,
}: {
  event: MatchClosedCelebrationEvent;
  audio: CelebrationAudioController;
  onDone: () => void;
}) {
  const audioRef = useRef(audio);
  const onDoneRef = useRef(onDone);
  const { match, teamA, teamB, score, pointsOnlyMode } = event;
  const scoreA = pointsOnlyMode ? score.teamA.points : score.teamA.vacas;
  const scoreB = pointsOnlyMode ? score.teamB.points : score.teamB.vacas;

  useEffect(() => {
    audioRef.current = audio;
    onDoneRef.current = onDone;
  }, [audio, onDone]);

  useEffect(() => {
    if (claimCelebrationAudio(`match:${event.id}`)) {
      audioRef.current.playMatchWin();
    }

    const timeoutId = window.setTimeout(() => onDoneRef.current(), 7800);

    return () => window.clearTimeout(timeoutId);
  }, [event.id]);

  const winnerIsTeamA = event.winnerId === teamA.id;

  return (
    <div className="celebration-overlay" role="status" aria-live="polite">
      <ConfettiBurst seed={event.id} />
      <div className="celebration-card celebration-card--match">
        <div className="celebration-card__header">
          <p>Mesa cerrada</p>
          <span>
            {match.bracketLabel} · mesa {match.table}
          </span>
        </div>
        <div className="celebration-match-title">
          <span>Resultado validado</span>
          <strong>{formatScoreSummary(score, pointsOnlyMode)}</strong>
        </div>
        <div className="celebration-result-grid">
          <CelebrationTeamPanel
            team={teamA}
            score={scoreA}
            isWinner={winnerIsTeamA}
            label={winnerIsTeamA ? "Ganadores" : "Rival"}
          />
          <div className="celebration-versus">
            <span>La mesa pasa a cerrada y el resultado queda bloqueado.</span>
            <strong>VS</strong>
          </div>
          <CelebrationTeamPanel
            team={teamB}
            score={scoreB}
            isWinner={!winnerIsTeamA}
            label={!winnerIsTeamA ? "Ganadores" : "Rival"}
          />
        </div>
      </div>
    </div>
  );
}

function TopCutRevealOverlay({
  reveal,
  audio,
  onDone,
}: {
  reveal: TopCutRevealState;
  audio: CelebrationAudioController;
  onDone: () => void;
}) {
  const audioRef = useRef(audio);
  const onDoneRef = useRef(onDone);
  const sortedItems = reveal.items.toSorted((left, right) => left.topRank - right.topRank);
  const revealKey = `${reveal.mode}:${sortedItems.map((item) => `${item.topRank}-${item.team.id}`).join("|")}`;
  const itemByRank = new Map(sortedItems.map((item) => [item.topRank, item]));

  useEffect(() => {
    audioRef.current = audio;
    onDoneRef.current = onDone;
  }, [audio, onDone]);

  useEffect(() => {
    const shouldPlayAudio = claimCelebrationAudio(`topcut:${revealKey}`);
    const doneId = window.setTimeout(() => onDoneRef.current(), 9800);

    if (shouldPlayAudio) {
      audioRef.current.playTopCutReveal();
    }

    return () => {
      window.clearTimeout(doneId);
    };
  }, [revealKey]);

  const slotItems = [
    { label: "Semifinal 1", left: itemByRank.get(1), right: itemByRank.get(4) },
    { label: "Semifinal 2", left: itemByRank.get(2), right: itemByRank.get(3) },
  ];

  return (
    <div className="celebration-overlay celebration-overlay--topcut" role="status" aria-live="polite">
      <ConfettiBurst seed={`topcut-${sortedItems.map((item) => item.team.id).join("-")}`} />
      <div className="celebration-card celebration-card--topcut">
        <div className="celebration-card__header">
          <p>Top 4 confirmado</p>
          <span>Las parejas toman posición</span>
        </div>

        <div className="topcut-reveal-row">
          {sortedItems.map(({ team, topRank }, index) => (
            <article
              key={`${team.id}-topcut-reveal`}
              className={`topcut-reveal-card topcut-reveal-card--rank-${topRank} topcut-reveal-card--fly-${topRank}`}
              style={{ animationDelay: `${index * 260}ms` }}
            >
              {topRank === 1 ? <CrownIcon className="topcut-reveal-card__crown" /> : null}
              <p>Top {topRank}</p>
              <TeamFaces team={team} size={topRank === 1 ? "xl" : "lg"} />
              <h3>{team.name}</h3>
              <span>{team.pointsWon} pts</span>
            </article>
          ))}
        </div>

        <div className="topcut-slots" aria-hidden="true">
          {slotItems.map((slot) => (
            <div key={slot.label} className="topcut-slot">
              <span>{slot.label}</span>
              <strong>{slot.left?.team.name ?? "Top"}</strong>
              <em>vs</em>
              <strong>{slot.right?.team.name ?? "Top"}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function PhaseTransitionOverlay({
  reveal,
  audio,
  onDone,
}: {
  reveal: PhaseTransitionRevealState;
  audio: CelebrationAudioController;
  onDone: () => void;
}) {
  const audioRef = useRef(audio);
  const onDoneRef = useRef(onDone);
  const revealKey = `${reveal.mode}:${reveal.teams.map((team) => team.id).join("|")}`;
  const isSemifinalReveal = reveal.mode === "swissToSemifinals";
  const isLeagueSemifinalReveal = reveal.mode === "leagueToFinals";
  const title = isLeagueSemifinalReveal
    ? "Fases finales preparadas"
    : isSemifinalReveal
      ? "Semifinales preparadas"
      : reveal.mode === "leagueSemifinalsToFinals"
        ? "Finales de liga preparadas"
        : "Final preparada";
  const subtitle = isLeagueSemifinalReveal
    ? "Champions, Europa y Conference toman posicion"
    : isSemifinalReveal
      ? "El Top 4 toma posicion"
      : "Los ganadores toman posicion";
  const teamLabel = isSemifinalReveal || isLeagueSemifinalReveal ? "Semifinalista" : "Finalista";
  const slotItems = isLeagueSemifinalReveal
    ? [
        { label: "Champions S1", left: reveal.teams[0], right: reveal.teams[1] },
        { label: "Champions S2", left: reveal.teams[2], right: reveal.teams[3] },
        { label: "Europa S1", left: reveal.teams[4], right: reveal.teams[5] },
        { label: "Europa S2", left: reveal.teams[6], right: reveal.teams[7] },
        { label: "Conference S1", left: reveal.teams[8], right: reveal.teams[9] },
        { label: "Conference S2", left: reveal.teams[10], right: reveal.teams[11] },
      ].filter((slot) => slot.left && slot.right)
    : isSemifinalReveal
      ? [
          { label: "Semifinal 1", left: reveal.teams[0], right: reveal.teams[3] },
          { label: "Semifinal 2", left: reveal.teams[1], right: reveal.teams[2] },
        ]
      : reveal.mode === "leagueSemifinalsToFinals"
        ? [
            { label: "Champions Final", left: reveal.teams[0], right: reveal.teams[1] },
            { label: "Europa Final", left: reveal.teams[2], right: reveal.teams[3] },
            { label: "Conference Final", left: reveal.teams[4], right: reveal.teams[5] },
          ].filter((slot) => slot.left && slot.right)
        : [{ label: "Final", left: reveal.teams[0], right: reveal.teams[1] }];

  useEffect(() => {
    audioRef.current = audio;
    onDoneRef.current = onDone;
  }, [audio, onDone]);

  useEffect(() => {
    const shouldPlayAudio = claimCelebrationAudio(`phase:${revealKey}`);
    const doneId = window.setTimeout(() => onDoneRef.current(), 7200);

    if (shouldPlayAudio) {
      if (isSemifinalReveal || isLeagueSemifinalReveal) {
        audioRef.current.playTopCutReveal();
      } else {
        audioRef.current.playFinalReveal();
      }
    }

    return () => {
      window.clearTimeout(doneId);
    };
  }, [isLeagueSemifinalReveal, isSemifinalReveal, revealKey]);

  return (
    <div className="celebration-overlay celebration-overlay--phase" role="status" aria-live="polite">
      <ConfettiBurst seed={`phase-${reveal.teams.map((team) => team.id).join("-")}`} />
      <div
        className={`celebration-card celebration-card--phase ${
          isSemifinalReveal || isLeagueSemifinalReveal ? "celebration-card--phase-semifinals" : ""
        }`}
      >
        <div className="celebration-card__header">
          <p>{title}</p>
          <span>{subtitle}</span>
        </div>

        <div className="phase-transition-track" data-team-count={reveal.teams.length}>
          {reveal.teams.map((team, index) => (
            <article
              key={`${team.id}-phase-transition`}
              className={`phase-transition-card phase-transition-card--${index + 1}`}
            >
              <p>
                {teamLabel} {index + 1}
              </p>
              <TeamFaces team={team} size="xl" />
              <h3>{team.name}</h3>
              <span>
                {isLeagueSemifinalReveal ? `${team.leaguePoints} pts liga` : `${team.pointsWon} pts`}
              </span>
            </article>
          ))}
        </div>

        <div className="phase-final-slots" data-team-count={reveal.teams.length} aria-hidden="true">
          {slotItems.map((slot) => (
            <div key={slot.label} className="phase-final-slot">
              <span>{slot.label}</span>
              <strong>{slot.left?.name ?? teamLabel}</strong>
              <em>vs</em>
              <strong>{slot.right?.name ?? teamLabel}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ChampionCelebrationOverlay({
  event,
  audio,
  onDone,
}: {
  event: ChampionCelebrationEvent;
  audio: CelebrationAudioController;
  onDone: () => void;
}) {
  const audioRef = useRef(audio);
  const onDoneRef = useRef(onDone);
  const { team } = event;

  useEffect(() => {
    audioRef.current = audio;
    onDoneRef.current = onDone;
  }, [audio, onDone]);

  useEffect(() => {
    if (claimCelebrationAudio(`champion:${event.id}`)) {
      audioRef.current.playChampion();
    }

    const timeoutId = window.setTimeout(() => onDoneRef.current(), 17200);

    return () => window.clearTimeout(timeoutId);
  }, [event.id]);

  return (
    <div className="celebration-overlay celebration-overlay--champion" role="status" aria-live="polite">
      <ConfettiBurst seed={event.id} intensity="final" />
      <div className="celebration-card celebration-card--champion">
        <div className="champion-trophy" aria-hidden="true">
          <div className="champion-trophy__cup" />
          <div className="champion-trophy__stem" />
          <div className="champion-trophy__base" />
        </div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-[var(--accent)]">
          Campeones
        </p>
        <CelebrationTeamPortraits team={team} showCrowns tone="winner" />
        <h2 className="mt-5 text-center text-6xl font-black tracking-tight text-[var(--foreground)]">
          {team.name}
        </h2>
        <p className="mt-2 text-center text-lg text-[var(--muted)]">
          {playerName(team, 0)} · {playerName(team, 1)}
        </p>
      </div>
    </div>
  );
}

function CelebrationAudioToggle({
  audio,
}: {
  audio: CelebrationAudioController;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        audio.unlock();
        if (audio.unlocked || audio.muted) {
          audio.toggleMuted();
        }
      }}
      className="celebration-audio-toggle"
      aria-pressed={!audio.muted}
      title={audio.muted ? "Activar sonido de celebraciones" : "Silenciar celebraciones"}
    >
      {audio.muted ? "Sonido off" : audio.unlocked ? "Sonido on" : "Activar sonido"}
    </button>
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
  hideWatermark = false,
  headerLogo = false,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  leftSlot?: ReactNode;
  rightSlot?: ReactNode;
  activeUrl?: string;
  hideWatermark?: boolean;
  headerLogo?: boolean;
  children: ReactNode;
}) {
  const viewportProfile = useViewportProfile();
  const headerGridClass = headerLogo
    ? "admin-header admin-header--with-logo grid gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4 shadow-[0_35px_120px_rgba(0,0,0,0.28)] md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center md:p-4"
    : "admin-header grid gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-4 shadow-[0_35px_120px_rgba(0,0,0,0.28)] md:grid-cols-[1fr_auto] md:p-4";

  return (
    <div className="relative h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.055)_0%,transparent_34%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.03)_50%,transparent_100%)] opacity-40" />
      {hideWatermark ? null : <TournamentWatermark />}

      <main
        className="admin-shell relative z-10 mx-auto flex h-[100svh] w-full max-w-[1920px] flex-col overflow-hidden px-3 py-4 md:px-4 md:py-5 2xl:px-5"
        data-density={viewportProfile.density}
        style={
          {
            "--admin-vw": `${viewportProfile.width}px`,
            "--admin-vh": `${viewportProfile.height}px`,
          } as CSSProperties
        }
      >
        <header className={headerGridClass}>
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
          {headerLogo ? (
            <div className="registration-header-logo">
              <img
                src="/logo_torneo.png"
                alt="Logo del torneo"
                style={{
                  width: "clamp(5.5rem, 7vw, 8rem)",
                  maxHeight: "clamp(5.5rem, 11vh, 8rem)",
                  objectFit: "contain",
                  opacity: 1,
                }}
              />
            </div>
          ) : null}
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
                <InfoHint label="Elige suizo solo para terminar por clasificación, suizo + top 4 para semifinales/final, o liga para todos contra todos con fases finales por clasificación." />
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
                <option value="league">Liga</option>
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
                min={form.format === "league" ? 30 : 30}
                max={form.format === "league" ? 40 : 40}
                step={form.format === "league" ? 10 : 1}
                value={form.targetPoints}
                onChange={(event) =>
                  onChange({
                    targetPoints:
                      form.format === "league" && Number(event.target.value) >= 35
                        ? "40"
                        : form.format === "league"
                          ? "30"
                          : event.target.value,
                  })
                }
                className="input-shell mt-2"
              />
              {form.format === "league" ? (
                <p className="mt-2 text-xs leading-5 text-[var(--muted-soft)]">
                  En liga solo se permite 30 o 40 para calcular los resultados por puntos.
                </p>
              ) : null}
            </label>

            {form.format === "league" ? (
              <label className="flex items-start gap-3 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-4 md:col-span-2">
                <input
                  type="checkbox"
                  checked={form.leagueLoserBonusEnabled}
                  onChange={(event) =>
                    onChange({ leagueLoserBonusEnabled: event.target.checked })
                  }
                  className="mt-1 h-4 w-4 accent-[var(--accent)]"
                />
                <span>
                  <span className="block font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--muted)]">
                    Bonus del perdedor
                  </span>
                  <span className="mt-2 block text-sm leading-6 text-[var(--muted-soft)]">
                    Si está activo, el perdedor suma +1 al llegar a{" "}
                    {form.targetPoints === "40" ? "30" : "20"} puntos. Si está apagado,
                    solo puntúa el ganador con +3.
                  </span>
                </span>
              </label>
            ) : null}
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

  return (
    <>
    <div className="registration-qr-card rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-3">
      <div>
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
      </div>

      <div className="mt-3 max-w-[145px]">
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
  canDelete = false,
  onDelete,
}: {
  participant: Participant;
  draggable?: boolean;
  dimmed?: boolean;
  onDragStart?: (participantId: string) => void;
  onDragEnd?: () => void;
  canEdit?: boolean;
  onEdit?: (participant: Participant) => void;
  canDelete?: boolean;
  onDelete?: (participant: Participant) => void;
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
      className={`rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] p-2.5 transition ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      } ${canEdit ? "cursor-pointer hover:border-[var(--accent-border)]" : ""} ${dimmed ? "opacity-45" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full border border-[var(--stroke)] bg-[var(--surface-raised)]">
            <img
              src={participant.photoUrl}
              alt={participant.name}
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0">
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
        {canDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onDelete?.(participant);
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-red-500/30 bg-red-500/10 font-mono text-sm leading-none text-red-100 transition hover:border-red-400/70 hover:bg-red-500/20"
            aria-label={`Eliminar a ${participant.name}`}
          >
            ×
          </button>
        ) : null}
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
  onDeleteParticipant,
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
  onDeleteParticipant: (participant: Participant) => void;
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
        hideWatermark
        headerLogo
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
                    <h3 className="mt-1 text-base font-semibold leading-tight text-[var(--foreground)]">
                      {registrationComplete
                        ? "Ya están todos los jugadores"
                        : `Faltan ${remainingCount} personas por entrar`}
                    </h3>
                  </div>
                </div>

                <div className="mt-2 grid gap-1.5 md:grid-cols-3">
                  <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2 py-1.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--accent)]">
                      Registrados
                    </p>
                    <p className="font-mono text-base font-semibold leading-none text-[var(--foreground)]">{registeredCount}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2 py-1.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--accent)]">
                      Objetivo
                    </p>
                    <p className="font-mono text-base font-semibold leading-none text-[var(--foreground)]">{expectedParticipants}</p>
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2 py-1.5">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--accent)]">
                      Parejas listas
                    </p>
                    <p className="font-mono text-base font-semibold leading-none text-[var(--foreground)]">
                      {state.teams.filter((team) => isTeamComplete(team) && team.confirmed).length}
                    </p>
                  </div>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
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

                <div className="mt-2 flex flex-wrap gap-1.5">
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

                {!canCreateTeams &&
                registeredCount > 0 &&
                (!participantCountIsEven || registeredCount >= expectedParticipants) ? (
                  <div className="mt-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2.5 py-1.5 text-[11px] leading-4 text-[var(--muted)]">
                    {!participantCountIsEven
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
                        canDelete
                        onDelete={onDeleteParticipant}
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
                              {team.name}
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
                          {team.name}
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
                  onDeleteParticipant(activeEditingBot);
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
  density = "regular",
  disabledOpen = false,
}: {
  match: Match;
  teamsById: Map<string, Team>;
  pointsOnlyMode: boolean;
  onOpen: (matchId: string) => void;
  density?: "regular" | "compact" | "micro" | "nano";
  disabledOpen?: boolean;
}) {
  const teamA = match.teamAId ? teamsById.get(match.teamAId) : null;
  const teamB = match.teamBId ? teamsById.get(match.teamBId) : null;
  const mobileConflict = getMatchMobileResultConflict(match);
  const compact = density !== "regular";
  const micro = density === "micro" || density === "nano";
  const nano = density === "nano";
  const tilePadding = nano ? "p-px" : micro ? "p-0.5" : compact ? "p-1" : "p-1.5";
  const metaText = nano
    ? "text-[6px] tracking-[0.1em]"
    : micro
      ? "text-[7px] tracking-[0.12em]"
      : compact
        ? "text-[8px] tracking-[0.14em]"
        : "text-[9px] tracking-[0.18em]";
  const teamFaceSize = nano ? "xxxs" : compact ? "xxs" : "xs";
  const teamRowClass = nano
    ? "grid min-h-0 grid-cols-[minmax(0,1fr)_22px] items-center gap-0.5 rounded-[6px] px-1 py-px"
    : micro
      ? "grid min-h-0 grid-cols-[minmax(0,1fr)_24px] items-center gap-1 rounded-[7px] px-1 py-0.5"
      : compact
        ? "grid min-h-0 grid-cols-[minmax(0,1fr)_28px] items-center gap-1.5 rounded-[7px] px-1.5 py-0.5"
        : "grid min-h-0 grid-cols-[minmax(0,1fr)_32px] items-center gap-2 rounded-[8px] px-2 py-1";
  const teamTextClass = nano
    ? "text-[8px] leading-[10px]"
    : micro
      ? "text-[9px] leading-3"
      : compact
        ? "text-[10px] leading-3"
        : "text-[11px] leading-4";
  const scoreClass = nano
    ? "h-4 min-w-5 rounded-[6px] px-0.5 text-[8px]"
    : micro
      ? "h-5 min-w-6 rounded-[7px] px-1 text-[10px]"
      : compact
        ? "h-6 min-w-7 rounded-[7px] px-1 text-[11px]"
        : "h-7 min-w-8 rounded-[8px] px-1.5 text-xs";
  const matchBodyGap = nano
    ? "mt-0.5 grid gap-px"
    : micro
      ? "mt-1 grid gap-0.5"
      : compact
        ? "mt-1 grid gap-0.5"
        : "mt-1.5 grid gap-1";
  const byeRowClass = nano
    ? "mt-0.5 flex min-w-0 items-center gap-1 rounded-[6px] bg-[rgba(242,247,238,0.03)] px-1 py-px"
    : micro
      ? "mt-1 flex min-w-0 items-center gap-1 rounded-[7px] bg-[rgba(242,247,238,0.03)] px-1 py-0.5"
      : compact
        ? "mt-1 flex min-w-0 items-center gap-1.5 rounded-[7px] bg-[rgba(242,247,238,0.03)] px-1.5 py-0.5"
        : "mt-1.5 flex min-w-0 items-center gap-2 rounded-[8px] bg-[rgba(242,247,238,0.03)] px-1.5 py-1";
  const scoreA = pointsOnlyMode
    ? match.score?.teamA.points ?? 0
    : match.score?.teamA.vacas ?? 0;
  const scoreB = pointsOnlyMode
    ? match.score?.teamB.points ?? 0
    : match.score?.teamB.vacas ?? 0;

  if (match.bye && teamA) {
    return (
      <div className={`match-tile rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] ${tilePadding} shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]`}>
        <div className="flex items-center justify-between gap-2">
          <p className={`font-mono uppercase text-[var(--accent)] ${metaText}`}>
            mesa {match.table}
          </p>
          <p className={`font-mono uppercase text-[var(--muted-soft)] ${metaText}`}>
            bye automático
          </p>
        </div>
        <div className={byeRowClass}>
          <TeamFaces team={teamA} size={teamFaceSize} />
          <p className={`min-w-0 truncate font-semibold text-[var(--foreground)] ${compact ? "text-[10px]" : "text-xs"}`}>
            {teamA.name}
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
      disabled={disabledOpen}
      className={`match-tile w-full rounded-[8px] border ${
        mobileConflict
          ? "border-rose-400/70 bg-rose-500/12"
          : "border-[var(--stroke)] bg-[var(--surface-strong)]"
      } ${tilePadding} text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition ${
        disabledOpen
          ? "cursor-default"
          : "hover:border-[var(--accent-border)] hover:bg-[var(--surface-raised)]"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className={`font-mono uppercase text-[var(--accent)] ${metaText}`}>
          mesa {match.table}
        </p>
        <p className={`font-mono uppercase text-[var(--muted-soft)] ${metaText}`}>
          {mobileConflict
            ? "revisar"
            : match.status === "completed"
            ? `${pointsOnlyMode ? match.score?.teamA.points ?? 0 : match.score?.teamA.vacas ?? 0}-${pointsOnlyMode ? match.score?.teamB.points ?? 0 : match.score?.teamB.vacas ?? 0}`
            : "pend."}
        </p>
      </div>

      <div className={matchBodyGap}>
        <div
          className={`${teamRowClass} ${
            pointsOnlyMode && match.status === "completed" && match.winnerId === teamA.id
              ? "border border-emerald-400/26 bg-emerald-500/10"
              : pointsOnlyMode && match.status === "completed" && match.loserId === teamA.id
                ? "border border-rose-400/18 bg-rose-500/8"
                : "bg-[rgba(242,247,238,0.03)]"
          }`}
        >
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <TeamFaces team={teamA} size={teamFaceSize} />
            <p
              className={`w-full min-w-0 truncate font-semibold ${teamTextClass} ${
                pointsOnlyMode && match.status === "completed" && match.winnerId === teamA.id
                  ? "text-emerald-200"
                  : pointsOnlyMode && match.status === "completed" && match.loserId === teamA.id
                    ? "text-rose-100"
                    : "text-[var(--foreground)]"
              }`}
            >
              {teamA.name}
            </p>
          </div>
          <div className={`flex flex-none items-center justify-center border border-[var(--accent-border)] bg-[var(--background)] font-mono font-extrabold text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${scoreClass}`}>
            {scoreA}
          </div>
        </div>

        <div className={`grid grid-cols-[1fr_auto_1fr] items-center ${nano ? "gap-0.5" : micro ? "gap-1" : "gap-2"}`}>
          <div className="h-px bg-[rgba(242,247,238,0.14)]" />
          <span className={`font-mono uppercase text-[var(--muted-soft)] ${nano ? "text-[5px] tracking-[0.1em]" : micro ? "text-[6px] tracking-[0.12em]" : "text-[8px] tracking-[0.18em]"}`}>
            vs
          </span>
          <div className="h-px bg-[rgba(242,247,238,0.14)]" />
        </div>

        <div
          className={`${teamRowClass} ${
            pointsOnlyMode && match.status === "completed" && match.winnerId === teamB.id
              ? "border border-emerald-400/26 bg-emerald-500/10"
              : pointsOnlyMode && match.status === "completed" && match.loserId === teamB.id
                ? "border border-rose-400/18 bg-rose-500/8"
                : "bg-[rgba(242,247,238,0.03)]"
          }`}
        >
          <div className="flex min-w-0 flex-col items-start gap-0.5">
            <TeamFaces team={teamB} size={teamFaceSize} />
            <p
              className={`w-full min-w-0 truncate font-semibold ${teamTextClass} ${
                pointsOnlyMode && match.status === "completed" && match.winnerId === teamB.id
                  ? "text-emerald-200"
                  : pointsOnlyMode && match.status === "completed" && match.loserId === teamB.id
                    ? "text-rose-100"
                    : "text-[var(--foreground)]"
              }`}
            >
              {teamB.name}
            </p>
          </div>
          <div className={`flex flex-none items-center justify-center border border-[var(--accent-border)] bg-[var(--background)] font-mono font-extrabold text-[var(--foreground)] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] ${scoreClass}`}>
            {scoreB}
          </div>
        </div>
      </div>
    </button>
  );
}

function chunkByRows<T>(items: T[], rowCount: number): T[][] {
  const safeRowCount = Math.max(1, rowCount);
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += safeRowCount) {
    chunks.push(items.slice(index, index + safeRowCount));
  }

  return chunks.length > 0 ? chunks : [[]];
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

function MobileResultReportsPanel({
  match,
  teamsById,
  pointsOnlyMode,
}: {
  match: Match;
  teamsById: Map<string, Team>;
  pointsOnlyMode: boolean;
}) {
  const reports = match.mobileResultReports ?? [];
  const mobileConflict = getMatchMobileResultConflict(match);

  if (reports.length === 0) {
    return null;
  }

  return (
    <section
      className={`mt-5 rounded-[8px] border p-4 ${
        mobileConflict
          ? "border-rose-400/60 bg-rose-500/10"
          : "border-[var(--stroke)] bg-[rgba(2,4,3,0.34)]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p
            className={`font-mono text-[10px] uppercase tracking-[0.2em] ${
              mobileConflict ? "text-rose-100" : "text-[var(--accent)]"
            }`}
          >
            Resultados desde móvil
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {mobileConflict
              ? "Las dos propuestas no coinciden. Revisa y cierra manualmente si hace falta."
              : reports.length === 1
                ? "Hay una propuesta enviada. Falta la confirmación del otro equipo."
                : "Las propuestas coinciden o la mesa ya está cerrada."}
          </p>
        </div>
        {mobileConflict ? (
          <span className="rounded-full border border-rose-300/40 bg-rose-500/16 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-rose-100">
            Revisar resultado
          </span>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {reports.map((report) => {
          const reportTeam = teamsById.get(report.teamId);

          return (
            <article
              key={`${match.id}-${report.teamId}-admin-mobile-report`}
              className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="min-w-0 truncate text-sm font-semibold text-[var(--foreground)]">
                  {reportTeam?.name ?? "Equipo"}
                </p>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-[var(--muted-soft)]">
                  {formatSyncTime(report.submittedAt)}
                </span>
              </div>
              <p className="mt-1 text-xs text-[var(--muted)]">
                {report.participantName}:{" "}
                <span className="font-semibold text-[var(--foreground)]">
                  {formatScoreSummary(report.score, pointsOnlyMode)}
                </span>
              </p>
            </article>
          );
        })}
      </div>
    </section>
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
  onForceSemifinals,
  onBack,
  isPending,
  celebrationLocked,
  viewerMode = false,
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
  onForceSemifinals: () => void;
  onBack: () => void;
  isPending: boolean;
  celebrationLocked: boolean;
  viewerMode?: boolean;
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
  const allGroupsDrawn =
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.revealed);
  const roundComplete =
    allGroupsDrawn &&
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.status === "completed");
  const topCutFooterItems = useMemo(() => getTopCutFooterItems(state), [state]);
  const qualifiedTopCutCount = topCutFooterItems.length;
  const canAdvanceToTopCut = structure.topCut > 0 && qualifiedTopCutCount >= structure.topCut;
  const finalClassificationItems = useMemo(
    () => getFinalClassificationItems(state, topCutFooterItems),
    [state, topCutFooterItems],
  );
  const showFinalClassification = canAdvanceToTopCut && roundComplete;
  const advanceLabel =
    structure.topCut > 0
      ? canAdvanceToTopCut
        ? "SEMIFINALES"
        : "Siguiente ronda"
      : state.currentSwissRound >= state.swissRoundsPlanned
        ? "Cerrar clasificación final"
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
  const nextDrawableGroupLabel =
    columns
      .flatMap((column) => column.boxes)
      .find(
        (box) =>
          box.isEditable &&
          box.hiddenMatches.length > 0 &&
          box.revealedMatches.length === 0,
      )?.label ?? null;
  const viewportProfile = useViewportProfile();
  const [swissBoardMeasureRef, measuredSwissBoardHeight] = useElementHeight<HTMLElement>();
  const maxSwissRows = Math.max(1, ...columns.map((column) => column.boxes.length));
  const maxBoxItems = Math.max(
    1,
    ...columns.flatMap((column) =>
      column.boxes.map((box) =>
        Math.max(
          box.revealedMatches.length,
          box.teams.length,
          box.qualifiedTeams.length,
          box.eliminatedTeams.length,
          box.hiddenMatches.length,
        ),
      ),
    ),
  );
  const swissDensity =
    state.config.teamCount >= 24 || maxBoxItems >= 12
      ? "dense"
      : state.config.teamCount >= 14 || maxBoxItems >= 8
        ? "balanced"
        : "roomy";
  const fallbackSwissBoardHeight = Math.max(
    320,
    viewportProfile.height - (viewportProfile.density === "compact" ? 108 : 132),
  );
  const swissBoardHeight = Math.max(320, measuredSwissBoardHeight || fallbackSwissBoardHeight);
  const swissBoxGap = viewportProfile.density === "compact" ? 6 : 8;
  const swissBoxHeaderHeight = swissDensity === "dense" ? 24 : 30;
  const swissBoxBodyPadding = swissDensity === "dense" ? 10 : 14;
  const swissItemGap = swissDensity === "dense" ? 5 : 6;
  const swissRowSafetyPx = swissDensity === "dense" ? 14 : 16;
  const swissRegularTeamRowHeight = swissDensity === "dense" ? 40 : 44;
  const swissCompactTeamRowHeight = swissDensity === "dense" ? 33 : 37;
  const swissNanoTeamRowHeight = swissDensity === "dense" ? 28 : 32;
  const swissRegularMatchRowHeight = swissDensity === "dense" ? 140 : 152;
  const swissCompactMatchRowHeight = swissDensity === "dense" ? 112 : 122;
  const swissMicroMatchRowHeight = swissDensity === "dense" ? 86 : 94;
  const swissNanoMatchRowHeight = swissDensity === "dense" ? 68 : 74;
  const swissMatchSafetyPx = swissDensity === "dense" ? 16 : 18;
  const getSwissBoxBodyHeight = (boxesInColumn: number): number => {
    const boxHeight =
      (swissBoardHeight - Math.max(0, boxesInColumn - 1) * swissBoxGap) / boxesInColumn;

    return Math.max(
      1,
      boxHeight - swissBoxHeaderHeight - swissBoxBodyPadding - swissItemGap * 2,
    );
  };
  const minimumTeamBoxBodyHeight = Math.min(
    Number.POSITIVE_INFINITY,
    ...columns.flatMap((column) =>
      column.boxes
        .filter((box) => box.teams.length > 0 && box.revealedMatches.length === 0)
        .map(() => getSwissBoxBodyHeight(column.boxes.length)),
    ),
  );
  const minimumRevealedBoxBodyHeight = Math.min(
    Number.POSITIVE_INFINITY,
    ...columns.flatMap((column) =>
      column.boxes
        .filter((box) => box.revealedMatches.length > 0)
        .map(() => getSwissBoxBodyHeight(column.boxes.length)),
    ),
  );
  const swissTeamRowDensity: "regular" | "compact" | "nano" =
    minimumTeamBoxBodyHeight === Number.POSITIVE_INFINITY ||
    minimumTeamBoxBodyHeight >= swissRegularTeamRowHeight + swissRowSafetyPx
      ? "regular"
      : minimumTeamBoxBodyHeight >= swissCompactTeamRowHeight + swissRowSafetyPx
        ? "compact"
        : "nano";
  const swissTeamRowHeight =
    swissTeamRowDensity === "nano"
      ? swissNanoTeamRowHeight
      : swissTeamRowDensity === "compact"
        ? swissCompactTeamRowHeight
        : swissRegularTeamRowHeight;
  const swissMatchTileDensity: "regular" | "compact" | "micro" | "nano" =
    minimumRevealedBoxBodyHeight === Number.POSITIVE_INFINITY ||
    minimumRevealedBoxBodyHeight >= swissRegularMatchRowHeight + swissMatchSafetyPx
      ? "regular"
      : minimumRevealedBoxBodyHeight >= swissCompactMatchRowHeight + swissMatchSafetyPx
        ? "compact"
        : minimumRevealedBoxBodyHeight >= swissMicroMatchRowHeight + swissMatchSafetyPx
          ? "micro"
          : "nano";
  const swissMatchRowHeight =
    swissMatchTileDensity === "nano"
      ? swissNanoMatchRowHeight
      : swissMatchTileDensity === "micro"
        ? swissMicroMatchRowHeight
        : swissMatchTileDensity === "compact"
          ? swissCompactMatchRowHeight
          : swissRegularMatchRowHeight;
  const swissItemWidth =
    swissMatchTileDensity === "nano"
      ? swissDensity === "dense"
        ? 118
        : 132
      : swissMatchTileDensity === "micro"
      ? swissDensity === "dense"
        ? 140
        : 154
      : swissMatchTileDensity === "compact"
        ? swissDensity === "dense"
          ? 154
          : 172
        : swissDensity === "dense"
          ? 168
          : 188;
  const getRowsThatFit = (
    itemHeight: number,
    availableBodyHeight: number,
    safetyPx: number,
  ): number => {
    const safeAvailableHeight = Math.max(1, availableBodyHeight - safetyPx);
    let rows = Math.max(
      1,
      Math.floor((safeAvailableHeight + swissItemGap) / (itemHeight + swissItemGap)),
    );

    while (
      rows > 1 &&
      rows * itemHeight + Math.max(0, rows - 1) * swissItemGap > safeAvailableHeight
    ) {
      rows -= 1;
    }

    return rows;
  };

  const getSwissBoxColumnLayout = (
    box: SwissColumn["boxes"][number],
    boxesInColumn: number,
  ): { columns: number; rows: number } => {
    const itemCount = Math.max(
      box.revealedMatches.length,
      box.teams.length,
      box.qualifiedTeams.length,
      box.eliminatedTeams.length,
      box.hiddenMatches.length,
      1,
    );
    const itemHeight = box.revealedMatches.length > 0 ? swissMatchRowHeight : swissTeamRowHeight;
    const itemSafetyPx =
      box.revealedMatches.length > 0 ? swissMatchSafetyPx : swissRowSafetyPx;
    const availableBodyHeight = getSwissBoxBodyHeight(boxesInColumn);
    const rows = getRowsThatFit(itemHeight, availableBodyHeight, itemSafetyPx);

    return {
      columns: Math.max(1, Math.ceil(itemCount / rows)),
      rows,
    };
  };
  const getSwissBoxWidth = (columnCount: number): number =>
    columnCount * swissItemWidth + Math.max(0, columnCount - 1) * swissItemGap + 18;

  return (
    <div className="relative h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.05)_0%,transparent_30%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <TournamentWatermark variant="swiss" />

      <main
        className="swiss-dashboard relative z-10 mx-auto grid h-[100svh] w-full max-w-none overflow-hidden px-2 py-2 md:px-3"
        data-density={viewportProfile.density}
        data-swiss-density={swissDensity}
        data-match-density={swissMatchTileDensity}
        data-team-row-density={swissTeamRowDensity}
        style={
          {
            "--admin-vw": `${viewportProfile.width}px`,
            "--admin-vh": `${viewportProfile.height}px`,
            "--swiss-max-rows": maxSwissRows,
            "--swiss-max-items": maxBoxItems,
            "--swiss-item-width": `${swissItemWidth}px`,
            "--swiss-item-gap": `${swissItemGap}px`,
            gridTemplateRows:
              topCutFooterItems.length > 0 ? "auto auto minmax(0, 1fr)" : "auto minmax(0, 1fr)",
          } as CSSProperties
        }
      >
        <header className="flex min-h-0 flex-wrap items-center gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button type="button" onClick={onBack} className={`swiss-back-button button-secondary ${viewerMode ? "hidden" : ""}`}>
              ← Volver al registro
            </button>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Paso 4 · Swiss Stage
            </p>
              <InfoHint label="Sortea cada tramo y abre solo la mesa que quieras cerrar." />
          </div>

          <div className="flex min-w-0 flex-none flex-wrap items-center justify-end gap-2">
            {!viewerMode && nextDrawableGroupLabel ? (
              <button
                type="button"
                onClick={() => onRevealGroup(nextDrawableGroupLabel)}
                className="swiss-draw-button button-primary"
              >
                Sortear {nextDrawableGroupLabel}
              </button>
            ) : null}
            <StageBadge label={`Ronda ${state.currentSwissRound} / ${state.swissRoundsPlanned}`} />
            {!viewerMode && structure.topCut > 0 ? (
              <button
                type="button"
                onClick={onForceSemifinals}
                disabled={isPending || celebrationLocked}
                className="button-secondary"
              >
                {celebrationLocked ? "Celebrando" : "Semifinales ahora"}
              </button>
            ) : null}
            {!viewerMode ? (
              <button
                type="button"
                onClick={onAdvance}
                disabled={isPending || celebrationLocked || (!roundComplete && !canAdvanceToTopCut)}
                className="button-primary"
              >
                {celebrationLocked ? "Esperando animaciones" : advanceLabel}
              </button>
            ) : (
              <StageBadge label="visor" />
            )}
            <div className="hidden max-w-[min(28vw,420px)] text-right xl:block">
              <p className="truncate font-mono text-[8px] uppercase tracking-[0.16em] text-[rgba(242,247,238,0.42)]">
                URL activa · {state.config.publicBaseUrl || "sin definir"}
              </p>
              <AdminCredit />
            </div>
          </div>
        </header>

        {topCutFooterItems.length > 0 ? (
          <section className="mt-1.5 flex min-h-0 flex-wrap items-center justify-center gap-1.5 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2.5 py-1.5">
              {topCutFooterItems.map(({ team, topRank }) => (
                <div
                  key={`${team.id}-header-top-${topRank}`}
                  className="flex min-w-[8.8rem] max-w-[12rem] items-center justify-between gap-2 rounded-[999px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2.5 py-1"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <TeamFaces team={team} size="xxs" />
                    <span className="min-w-0 truncate text-[11px] font-semibold text-[var(--foreground)]">
                      {team.name}
                    </span>
                  </div>
                  <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                    Top {topRank}
                  </span>
                </div>
              ))}
          </section>
        ) : null}

        <section ref={swissBoardMeasureRef} className="mt-1.5 min-h-0 overflow-hidden">
          {showFinalClassification ? (
            <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--accent-border)] bg-[var(--surface-inset)] shadow-[0_22px_80px_rgba(124,255,79,0.1)]">
              <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--accent-border)] bg-[linear-gradient(90deg,#7cff4f,#a6ff82)] px-4 py-2 text-[var(--accent-ink)]">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em]">
                    Clasificación final
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">
                    Top 4 cerrado. Puedes pasar a semifinales cuando quieras.
                  </p>
                </div>
                <span className="font-mono text-[10px] uppercase tracking-[0.18em]">
                  {finalClassificationItems.length} parejas
                </span>
              </div>

              <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fit,minmax(210px,1fr))] content-start gap-2 overflow-hidden p-3">
                {finalClassificationItems.map(({ team, rank, topRank }) => (
                  <article
                    key={`${team.id}-final-classification`}
                    className={`flex min-w-0 items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2 ${
                      topRank
                        ? "border-[var(--accent-border)] bg-[var(--accent-soft)]"
                        : "border-[var(--stroke)] bg-[var(--surface-strong)]"
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className={`flex h-7 w-8 flex-none items-center justify-center rounded-[7px] font-mono text-[11px] font-bold ${
                          topRank
                            ? "bg-[var(--accent)] text-[var(--accent-ink)]"
                            : "bg-[var(--surface)] text-[var(--muted)]"
                        }`}
                      >
                        {rank}
                      </span>
                      <TeamFaces team={team} size="xxs" />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                          {team.name}
                        </p>
                        <p className="font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">
                          {team.wins}-{team.losses} · {team.pointsWon} pts
                        </p>
                      </div>
                    </div>
                    <span
                      className={`font-mono text-[9px] font-bold uppercase tracking-[0.14em] ${
                        topRank ? "text-[var(--accent)]" : "text-[var(--muted-soft)]"
                      }`}
                    >
                      {topRank ? `Top ${topRank}` : `#${rank}`}
                    </span>
                  </article>
                ))}
              </div>
            </div>
          ) : (
          <div className="swiss-board flex h-full min-w-0 gap-2 overflow-x-auto overflow-y-hidden pb-1 pr-2">
            {columns.map((column) => (
              <div
                key={column.depth}
                className="swiss-column flex h-full w-max flex-none flex-col items-start gap-2"
                aria-label={`Tramo ${column.depth}`}
              >
                {column.boxes.map((box) => {
                  const hasQualifiedTeams = box.qualifiedTeams.length > 0;
                  const hasEliminatedTeams = box.eliminatedTeams.length > 0;
                  const hasContent =
                    box.matches.length > 0 ||
                    box.teams.length > 0 ||
                    hasQualifiedTeams ||
                    hasEliminatedTeams;
                  const shouldShowDrawButton =
                    box.isEditable &&
                    box.hiddenMatches.length > 0 &&
                    box.revealedMatches.length === 0;
                  const boxColumnLayout = getSwissBoxColumnLayout(
                    box,
                    column.boxes.length,
                  );
                  const revealedMatchColumns = chunkByRows(
                    box.revealedMatches,
                    boxColumnLayout.rows,
                  );
                  const teamColumns = chunkByRows(box.teams, boxColumnLayout.rows);
                  const qualifiedTeamColumns = chunkByRows(
                    box.qualifiedTeams,
                    boxColumnLayout.rows,
                  );
                  const eliminatedTeamColumns = chunkByRows(
                    box.eliminatedTeams,
                    boxColumnLayout.rows,
                  );
                  const renderedColumnCount =
                    box.revealedMatches.length > 0
                      ? revealedMatchColumns.length
                      : box.teams.length > 0
                        ? teamColumns.length
                        : hasQualifiedTeams
                          ? qualifiedTeamColumns.length
                        : hasEliminatedTeams
                          ? eliminatedTeamColumns.length
                        : 1;
                  const boxWidth = getSwissBoxWidth(renderedColumnCount);
                  const teamRowClass =
                    swissTeamRowDensity === "nano"
                      ? "swiss-team-row stagger-rise flex min-h-0 items-center justify-between gap-1 rounded-[7px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-1.5 py-0.5"
                      : swissTeamRowDensity === "compact"
                        ? "swiss-team-row stagger-rise flex min-h-0 items-center justify-between gap-1.5 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2 py-0.5"
                        : "swiss-team-row stagger-rise flex min-h-0 items-center justify-between gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-strong)] px-2 py-1";
                  const teamRowFaceSize =
                    swissTeamRowDensity === "nano"
                      ? "xxs"
                      : swissTeamRowDensity === "compact"
                        ? "xxs"
                        : "xs";
                  const teamRowTextClass =
                    swissTeamRowDensity === "nano"
                      ? "text-[10px] leading-3"
                      : swissTeamRowDensity === "compact"
                        ? "text-[11px] leading-3"
                        : "text-xs";
                  const teamRowScoreClass =
                    swissTeamRowDensity === "nano"
                      ? "text-[8px] tracking-[0.14em]"
                      : "text-[9px] tracking-[0.18em]";

                  return (
                    <div
                      key={box.label}
                      className={`swiss-box relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border ${
                        hasQualifiedTeams && !box.matches.length && !box.teams.length
                          ? "border-[var(--accent)] shadow-[0_18px_48px_rgba(124,255,79,0.16)]"
                          : hasEliminatedTeams && !box.matches.length && !box.teams.length
                          ? "border-rose-500/60 shadow-[0_18px_48px_rgba(244,63,94,0.12)]"
                          : box.isEditable
                          ? "border-[var(--accent)] shadow-[0_18px_48px_rgba(124,255,79,0.14)]"
                          : "border-[var(--stroke)]"
                      } ${
                        hasQualifiedTeams && !box.matches.length && !box.teams.length
                          ? "bg-[rgba(124,255,79,0.08)]"
                          : hasEliminatedTeams && !box.matches.length && !box.teams.length
                          ? "bg-rose-950/20"
                          : hasContent
                            ? "bg-[var(--surface-inset)]"
                            : "bg-[rgba(11,16,12,0.72)]"
                      }`}
                      style={{
                        width: `${boxWidth}px`,
                        minWidth: `${boxWidth}px`,
                        maxWidth: `${boxWidth}px`,
                        justifySelf: "start",
                      }}
                    >
                      <div
                        className={`swiss-box-header flex flex-none items-center justify-between border-b px-3 py-2 ${
                          hasQualifiedTeams && !box.matches.length && !box.teams.length
                            ? "border-[var(--accent-border)] bg-[linear-gradient(90deg,#7cff4f,#a6ff82)] text-[var(--accent-ink)]"
                            : hasEliminatedTeams && !box.matches.length && !box.teams.length
                            ? "border-rose-400/30 bg-rose-500/18 text-rose-100"
                            : box.isEditable
                            ? "border-[var(--accent-border)] bg-[linear-gradient(90deg,#7cff4f,#a6ff82)] text-[var(--accent-ink)]"
                            : "border-[var(--stroke)] bg-[#f4f7ef] text-[var(--background)]"
                        }`}
                      >
                        <span className="font-mono text-base font-semibold tracking-[0.12em]">
                          {box.label}
                        </span>
                        <span className="font-mono text-[9px] uppercase tracking-[0.18em]">
                          {shouldShowDrawButton
                            ? "por sortear"
                            : box.revealedMatches.length > 0
                              ? "mesas"
                              : box.teams.length
                                ? "estado"
                                : hasQualifiedTeams
                                  ? "clasificados"
                                : hasEliminatedTeams
                                  ? "eliminados"
                                : "vacío"}
                        </span>
                      </div>

                      <div className="swiss-box-body min-h-0 flex-1 overflow-hidden p-2">
                        {box.revealedMatches.length > 0 ? (
                          <div className="swiss-items-columns h-full overflow-hidden">
                            {revealedMatchColumns.map((matchColumn, columnIndex) => (
                              <div
                                key={`${box.label}-match-column-${columnIndex}`}
                                className="swiss-items-column"
                                style={{ width: `${swissItemWidth}px` }}
                              >
                                {matchColumn.map((match) => (
                                  <MatchTile
                                    key={match.id}
                                    match={match}
                                    teamsById={teamsById}
                                    pointsOnlyMode={pointsOnlyMode}
                                    onOpen={onOpenMatch}
                                    density={swissMatchTileDensity}
                                    disabledOpen={viewerMode}
                                  />
                                ))}
                              </div>
                            ))}
                          </div>
                        ) : box.teams.length > 0 ? (
                          <div className="swiss-items-columns h-full overflow-hidden">
                            {teamColumns.map((teamColumn, columnIndex) => (
                              <div
                                key={`${box.label}-team-column-${columnIndex}`}
                                className="swiss-items-column"
                                style={{ width: `${swissItemWidth}px` }}
                              >
                                {teamColumn.map((team, rowIndex) => {
                                  const itemIndex = columnIndex * boxColumnLayout.rows + rowIndex;

                                  if (team) {
                                    return (
                                      <div
                                        key={team.id}
                                        className={teamRowClass}
                                        style={{ animationDelay: `${itemIndex * 45}ms` }}
                                      >
                                        <div className="flex min-w-0 items-center gap-1.5">
                                          <TeamFaces team={team} size={teamRowFaceSize} />
                                          <p className={`min-w-0 truncate font-semibold text-[var(--foreground)] ${teamRowTextClass}`}>
                                            {team.name}
                                          </p>
                                        </div>
                                        <span className={`font-mono uppercase text-[var(--accent)] ${teamRowScoreClass}`}>
                                          {team.wins}-{team.losses}
                                        </span>
                                      </div>
                                    );
                                  }

                                  return null;
                                })}
                              </div>
                            ))}
                          </div>
                        ) : hasQualifiedTeams ? (
                          <div className="swiss-items-columns h-full overflow-hidden">
                            {qualifiedTeamColumns.map((teamColumn, columnIndex) => (
                              <div
                                key={`${box.label}-qualified-column-${columnIndex}`}
                                className="swiss-items-column"
                                style={{ width: `${swissItemWidth}px` }}
                              >
                                {teamColumn.map(({ team, topRank }, rowIndex) => {
                                  const itemIndex = columnIndex * boxColumnLayout.rows + rowIndex;

                                  return (
                                    <div
                                      key={`${team.id}-top-${topRank}`}
                                      className="swiss-team-row stagger-rise flex min-h-0 items-center justify-between gap-1.5 rounded-[8px] border border-[var(--accent-border)] bg-[var(--accent-soft)] px-2 py-1"
                                      style={{ animationDelay: `${itemIndex * 45}ms` }}
                                    >
                                      <div className="flex min-w-0 items-center gap-1.5">
                                        <TeamFaces team={team} size="xxs" />
                                        <div className="min-w-0">
                                          <p className="min-w-0 truncate text-[11px] font-semibold leading-3 text-[var(--foreground)]">
                                            {team.name}
                                          </p>
                                          <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-[var(--muted)]">
                                            {team.pointsWon} pts
                                          </p>
                                        </div>
                                      </div>
                                      <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[var(--accent)]">
                                        Top {topRank}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        ) : hasEliminatedTeams ? (
                          <div className="swiss-items-columns h-full overflow-hidden">
                            {eliminatedTeamColumns.map((teamColumn, columnIndex) => (
                              <div
                                key={`${box.label}-eliminated-column-${columnIndex}`}
                                className="swiss-items-column"
                                style={{ width: `${swissItemWidth}px` }}
                              >
                                {teamColumn.map((team, rowIndex) => {
                                  const itemIndex = columnIndex * boxColumnLayout.rows + rowIndex;

                                  return (
                                    <div
                                      key={team.id}
                                      className="swiss-team-row stagger-rise flex min-h-0 items-center justify-between gap-1.5 rounded-[8px] border border-rose-400/26 bg-rose-500/10 px-2 py-0.5"
                                      style={{ animationDelay: `${itemIndex * 45}ms` }}
                                    >
                                      <div className="flex min-w-0 items-center gap-1.5">
                                        <TeamFaces team={team} size="xxs" />
                                        <p className="min-w-0 truncate text-[11px] font-semibold leading-3 text-rose-100">
                                          {team.name}
                                        </p>
                                      </div>
                                      <span className="font-mono text-[8px] uppercase tracking-[0.14em] text-rose-200/80">
                                        fuera
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex h-full items-center justify-center text-center text-xs leading-5 text-[var(--muted-soft)]">
                            Caja preparada
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          )}
        </section>

      </main>
      <FeedbackToast feedback={feedback} />

      {!viewerMode && activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
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

              <MobileResultReportsPanel
                match={activeMatch}
                teamsById={teamsById}
                pointsOnlyMode={pointsOnlyMode}
              />

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

function getLeagueBandClass(rank: number): string {
  if (rank <= 4) {
    return "border-[var(--accent-border)] bg-[rgba(124,255,79,0.18)]";
  }

  if (rank <= 8) {
    return "border-sky-300/35 bg-sky-400/12";
  }

  if (rank <= 12) {
    return "border-amber-300/30 bg-amber-300/10";
  }

  return "border-[var(--stroke)] bg-[var(--surface-strong)]";
}

function LeagueStageScreen({
  state,
  resultDrafts,
  onResultDraftChange,
  onSaveMatch,
  onRevealRound,
  onOpenMatch,
  onCloseMatch,
  activeMatchId,
  onAdvance,
  onForceLeagueFinals,
  onBack,
  isPending,
  celebrationLocked,
  viewerMode = false,
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
  onRevealRound: () => void;
  onOpenMatch: (matchId: string) => void;
  onCloseMatch: () => void;
  activeMatchId: string | null;
  onAdvance: () => void;
  onForceLeagueFinals: () => void;
  onBack: () => void;
  isPending: boolean;
  celebrationLocked: boolean;
  viewerMode?: boolean;
  feedback: FeedbackState | null;
}) {
  const pointsOnlyMode = isPointsOnlyMatchFormat(state.config);
  const teamsById = useMemo(
    () => new Map(state.teams.map((team) => [team.id, team])),
    [state.teams],
  );
  const standings = useMemo(() => getLeagueRankedTeams(state), [state]);
  const currentRoundMatches = getCurrentLeagueMatches(state);
  const allRoundMatchesRevealed =
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.revealed);
  const roundComplete =
    allRoundMatchesRevealed &&
    currentRoundMatches.length > 0 &&
    currentRoundMatches.every((match) => match.status === "completed" || match.bye);
  const canLaunchFinals = state.config.teamCount > 4;
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
  const advanceLabel =
    state.currentSwissRound >= state.swissRoundsPlanned
      ? canLaunchFinals
        ? "Fases finales"
        : "Cerrar liga"
      : "Pasar ronda";

  return (
    <div className="relative h-[100svh] overflow-hidden bg-[var(--background)] text-[var(--foreground)]">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(124,255,79,0.05)_0%,transparent_30%),linear-gradient(180deg,#020403_0%,#040705_100%)]" />
      <TournamentWatermark variant="swiss" />

      <main className="relative z-10 mx-auto grid h-[100svh] w-full max-w-none grid-rows-[auto_minmax(0,1fr)] gap-2 overflow-hidden px-2 py-2 md:px-3">
        <header className="flex min-h-0 flex-wrap items-center gap-2 rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] px-2 py-1.5">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <button type="button" onClick={onBack} className={`button-secondary ${viewerMode ? "hidden" : ""}`}>
              ← Volver al registro
            </button>
            <p className="truncate font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
              Paso 4 · Liga
            </p>
            <InfoHint label="Sortea la ronda actual, cierra mesas y la clasificación se actualiza al momento." />
          </div>

          <div className="flex min-w-0 flex-none flex-wrap items-center justify-end gap-2">
            {!viewerMode && !allRoundMatchesRevealed ? (
              <button
                type="button"
                onClick={onRevealRound}
                disabled={isPending || celebrationLocked}
                className="button-primary"
              >
                Sortear ronda {state.currentSwissRound}
              </button>
            ) : null}
            {!viewerMode ? (
              <button
                type="button"
                onClick={onForceLeagueFinals}
                disabled={isPending || celebrationLocked || !canLaunchFinals}
                className="button-secondary"
              >
                Fases finales ahora
              </button>
            ) : null}
            <StageBadge label={`Ronda ${state.currentSwissRound} / ${state.swissRoundsPlanned}`} />
            {!viewerMode ? (
              <button
                type="button"
                onClick={onAdvance}
                disabled={isPending || celebrationLocked || !roundComplete}
                className="button-primary"
              >
                {celebrationLocked ? "Esperando animaciones" : advanceLabel}
              </button>
            ) : (
              <StageBadge label="visor" />
            )}
            <div className="hidden max-w-[min(28vw,420px)] text-right xl:block">
              <p className="truncate font-mono text-[8px] uppercase tracking-[0.16em] text-[rgba(242,247,238,0.42)]">
                URL activa · {state.config.publicBaseUrl || "sin definir"}
              </p>
              <AdminCredit />
            </div>
          </div>
        </header>

        <div className="grid min-h-0 gap-2 lg:grid-cols-[minmax(300px,0.34fr)_minmax(0,0.66fr)]">
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)]">
            <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
                  Clasificación
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Puntos liga · vacas · juegos · puntos
                </p>
              </div>
              <StageBadge label={`${standings.length} parejas`} />
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
              {standings.map((team, index) => {
                const rank = index + 1;

                return (
                  <article
                    key={`${team.id}-league-standing`}
                    className={`flex min-w-0 items-center justify-between gap-2 rounded-[8px] border px-2.5 py-2 ${getLeagueBandClass(rank)}`}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="flex h-8 w-9 flex-none items-center justify-center rounded-[7px] bg-[rgba(2,4,3,0.42)] font-mono text-xs font-bold text-[var(--foreground)]">
                        {rank}
                      </span>
                      <TeamFaces team={team} size="xs" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-[var(--foreground)]">
                          {team.name}
                        </p>
                        <p className="font-mono text-[8px] uppercase tracking-[0.13em] text-[var(--muted-soft)]">
                          {team.vacasWon}V · {team.gamesWon}J · {team.pointsWon}P
                        </p>
                      </div>
                    </div>
                    <span className="flex h-8 min-w-10 items-center justify-center rounded-[7px] border border-[var(--accent-border)] bg-[var(--background)] font-mono text-sm font-black text-[var(--accent)]">
                      {team.leaguePoints}
                    </span>
                  </article>
                );
              })}
            </div>
          </aside>

          <section className="flex min-h-0 flex-col overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[var(--surface-inset)]">
            <div className="flex flex-none items-center justify-between gap-3 border-b border-[var(--stroke)] bg-[var(--surface-strong)] px-4 py-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
                  Mesas de la ronda
                </p>
                <h2 className="mt-1 text-2xl font-semibold text-[var(--foreground)]">
                  Ronda {state.currentSwissRound}
                </h2>
              </div>
              <StageBadge label={roundComplete ? "ronda cerrada" : allRoundMatchesRevealed ? "en juego" : "sin sortear"} />
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              {allRoundMatchesRevealed ? (
                <div className="grid auto-rows-min gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {currentRoundMatches.map((match) => (
                    <MatchTile
                      key={match.id}
                      match={match}
                      teamsById={teamsById}
                      pointsOnlyMode={pointsOnlyMode}
                      onOpen={onOpenMatch}
                      disabledOpen={viewerMode}
                    />
                  ))}
                </div>
              ) : (
                <div className="flex h-full min-h-[320px] items-center justify-center rounded-[8px] border border-dashed border-[var(--stroke)] bg-[rgba(2,4,3,0.24)] text-center">
                  <div className="max-w-md px-6">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                      Ronda oculta
                    </p>
                    <p className="mt-3 text-sm leading-6 text-[var(--muted)]">
                      Pulsa sortear para mostrar mesas y descansos de esta ronda en PC y móviles.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>
      <FeedbackToast feedback={feedback} />

      {!viewerMode && activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
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

              <MobileResultReportsPanel
                match={activeMatch}
                teamsById={teamsById}
                pointsOnlyMode={pointsOnlyMode}
              />

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
  celebrationLocked,
  viewerMode = false,
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
  celebrationLocked: boolean;
  viewerMode?: boolean;
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
  const isSemifinals = state.stage === "semifinals" || state.stage === "leagueSemifinals";
  const isLeaguePlayoff =
    state.stage === "leagueSemifinals" || state.stage === "leagueFinals";
  const title = isLeaguePlayoff
    ? state.stage === "leagueSemifinals"
      ? "FASES FINALES"
      : "FINALES DE LIGA"
    : isSemifinals
      ? "SEMIFINALES"
      : "FINAL";
  const advanceLabel = isSemifinals ? "Pasar a la final" : "Cerrar torneo";
  const matchesByTier = new Map<LeagueFinalTier, Match[]>();

  for (const match of currentMatches) {
    if (!match.leagueTier) {
      continue;
    }

    matchesByTier.set(match.leagueTier, [...(matchesByTier.get(match.leagueTier) ?? []), match]);
  }

  return (
    <ScreenFrame
      eyebrow={
        isLeaguePlayoff
          ? state.stage === "leagueSemifinals"
            ? "Liga · Semifinales"
            : "Liga · Finales"
          : isSemifinals
            ? "Fase final · Semifinales"
            : "Fase final · Final"
      }
      title={title}
      activeUrl={state.config.publicBaseUrl}
      leftSlot={
        viewerMode ? (
          <StageBadge label="Control en movil admin" />
        ) : (
          <BackButton label="Volver a configuración" onClick={onBack} />
        )
      }
      rightSlot={
        <div className="flex flex-wrap gap-2">
          <StageBadge label={formatTournamentFormatLabel(state.config.format)} />
          <StageBadge label={`Sync ${formatSyncTime(state.updatedAt)}`} />
          <StageBadge label={state.config.title} />
        </div>
      }
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3">
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

        <section className="relative grid min-h-0 items-center gap-4 overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[radial-gradient(circle_at_center,rgba(124,255,79,0.12),transparent_38%),var(--surface-inset)] p-4 lg:grid-cols-[minmax(240px,1fr)_minmax(180px,0.7fr)_minmax(240px,1fr)]">
          {isLeaguePlayoff ? (
            <div className="col-span-full grid min-h-0 w-full gap-4 lg:grid-cols-3">
              {Array.from(matchesByTier.entries()).map(([tier, matches]) => (
                <section
                  key={`${tier}-playoff-section`}
                  className="min-w-0 rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.26)] p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--accent)]">
                        {getLeagueFinalTierLabel(tier)}
                      </p>
                      <h3 className="mt-1 text-xl font-semibold text-[var(--foreground)]">
                        {state.stage === "leagueSemifinals" ? "Semifinales" : "Final"}
                      </h3>
                    </div>
                    <StageBadge label={`${matches.length} mesas`} />
                  </div>
                  <div className="grid gap-3">
                    {matches
                      .slice()
                      .sort((left, right) => left.table - right.table)
                      .map((match) => (
                        <MatchTile
                          key={match.id}
                          match={match}
                          teamsById={teamsById}
                          pointsOnlyMode={pointsOnlyMode}
                          onOpen={onOpenMatch}
                          disabledOpen={viewerMode}
                        />
                      ))}
                  </div>
                </section>
              ))}
            </div>
          ) : isSemifinals ? (
            <>
              <div className="min-w-0">
                {currentMatches[0] ? (
                  <MatchTile
                    match={currentMatches[0]}
                    teamsById={teamsById}
                    pointsOnlyMode={pointsOnlyMode}
                    onOpen={onOpenMatch}
                    disabledOpen={viewerMode}
                  />
                ) : null}
              </div>
              <div className="flex h-full min-h-52 flex-col items-center justify-center gap-4">
                <div className="h-px w-full bg-[linear-gradient(90deg,transparent,var(--accent),transparent)]" />
                <div className="grid h-40 w-40 place-items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-soft)] text-center shadow-[0_0_80px_rgba(124,255,79,0.12)]">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                      camino
                    </p>
                    <p className="mt-1 text-4xl font-black tracking-tight text-[var(--accent)]">
                      COPA
                    </p>
                  </div>
                </div>
                <div className="h-px w-full bg-[linear-gradient(90deg,transparent,var(--accent),transparent)]" />
              </div>
              <div className="min-w-0">
                {currentMatches[1] ? (
                  <MatchTile
                    match={currentMatches[1]}
                    teamsById={teamsById}
                    pointsOnlyMode={pointsOnlyMode}
                    onOpen={onOpenMatch}
                    disabledOpen={viewerMode}
                  />
                ) : null}
              </div>
            </>
          ) : (
            <div className="col-span-full mx-auto w-full max-w-2xl">
              <div className="mb-4 text-center">
                <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--accent)]">
                  última mesa
                </p>
                <h3 className="mt-1 text-5xl font-black tracking-tight text-[var(--foreground)]">
                  FINAL
                </h3>
              </div>
              {currentMatches[0] ? (
                <MatchTile
                  match={currentMatches[0]}
                  teamsById={teamsById}
                  pointsOnlyMode={pointsOnlyMode}
                  onOpen={onOpenMatch}
                  disabledOpen={viewerMode}
                />
              ) : null}
            </div>
          )}
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[var(--stroke)] bg-[rgba(2,4,3,0.82)] px-5 py-4">
          <div className="flex flex-wrap gap-2">
            <StageBadge label={`${currentMatches.length} enfrentamientos`} />
            <StageBadge label={roundComplete ? "fase cerrada" : "faltan resultados"} />
          </div>

          {!viewerMode ? (
            <div className="flex flex-wrap gap-3">
              <button type="button" onClick={onSync} disabled={isSyncing} className="button-secondary">
                {isSyncing ? "Sincronizando" : "Sincronizar"}
              </button>
              <button
                type="button"
                onClick={onAdvance}
                disabled={isPending || celebrationLocked || !roundComplete}
                className="button-primary"
              >
                {celebrationLocked ? "Esperando animaciones" : advanceLabel}
              </button>
            </div>
          ) : (
            <StageBadge label="Control desde movil" />
          )}
        </footer>
      </div>

      {!viewerMode && activeMatch && activeTeams?.teamA && activeTeams.teamB ? (
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

              <MobileResultReportsPanel
                match={activeMatch}
                teamsById={teamsById}
                pointsOnlyMode={pointsOnlyMode}
              />

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
  const title = "CLASIFICACIÓN";
  const leagueFinalEntries = (["champions", "europa", "conference"] as const)
    .map((tier) => ({
      tier,
      result: state.leagueFinalResults?.[tier],
    }))
    .filter((entry) => entry.result?.championTeamId);
  const isLeague = state.config.format === "league";

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
      <div className="flex h-full min-h-0 flex-col gap-4">
        {leagueFinalEntries.length > 0 ? (
          <section className="grid flex-none gap-4 md:grid-cols-3">
            {leagueFinalEntries.map(({ tier, result }) => {
              const champion = state.teams.find(
                (entry) => entry.id === result?.championTeamId,
              );
              const runnerUp = state.teams.find(
                (entry) => entry.id === result?.runnerUpTeamId,
              );

              if (!champion) {
                return null;
              }

              return (
                <div
                  key={`${tier}-winner-card`}
                  className="rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)] p-5"
                >
                  <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">
                    {getLeagueFinalTierLabel(tier)}
                  </p>
                  <div className="mt-4 flex items-center gap-3">
                    <TeamFaces team={champion} />
                    <div className="min-w-0">
                      <p className="truncate text-xl font-semibold text-[var(--foreground)]">
                        {champion.name}
                      </p>
                      <p className="truncate text-sm text-[var(--muted-soft)]">
                        Campeón{runnerUp ? ` · final contra ${runnerUp.name}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        ) : state.championTeamId ? (
          <section className="grid flex-none gap-4 md:grid-cols-2">
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

        <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[8px] border border-[var(--stroke)] bg-[var(--surface)]">
          <div className="overflow-x-auto">
            <div className="min-w-[1040px]">
              <div className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px_120px] gap-3 border-b border-[var(--stroke)] bg-[var(--surface-strong)] px-5 py-3 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-soft)]">
                <span>Puesto</span>
                <span>Equipo</span>
                <span>{isLeague ? "Liga pts" : "Balance"}</span>
                <span>Balance</span>
                <span>Buchholz</span>
                <span>Vacas</span>
                <span>Juegos</span>
                <span>Puntos</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[1040px] divide-y divide-[var(--stroke)]">
              {state.teams.map((team, index) => (
                <div
                  key={team.id}
                  className="grid grid-cols-[72px_minmax(0,1.4fr)_120px_120px_120px_120px_120px_120px] gap-3 px-5 py-3"
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
                    {isLeague ? team.leaguePoints : `${team.wins}-${team.losses}`}
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
  const [celebrationQueue, setCelebrationQueue] = useState<CelebrationEvent[]>([]);
  const [activeCelebration, setActiveCelebration] = useState<CelebrationEvent | null>(null);
  const [topCutReveal, setTopCutReveal] = useState<TopCutRevealState | null>(null);
  const [phaseTransitionReveal, setPhaseTransitionReveal] =
    useState<PhaseTransitionRevealState | null>(null);
  const [isPending, startTransition] = useTransition();
  const audio = useCelebrationAudio();
  const previousStateRef = useRef<TournamentState | null>(null);
  const latestStateRef = useRef<TournamentState>(initialState);
  const seenCelebrationIdsRef = useRef<Set<string> | null>(null);
  const activeCelebrationRef = useRef<CelebrationEvent | null>(null);
  const celebrationQueueRef = useRef<CelebrationEvent[]>([]);
  const applyTournamentStateRef = useRef<(nextState: TournamentState) => void>(() => undefined);
  const suppressNextPhaseRevealRef = useRef(false);
  const browserOrigin = useSyncExternalStore(
    subscribeToNothing,
    getBrowserOriginSnapshot,
    () => "",
  );
  const celebrationLocked =
    Boolean(activeCelebration) ||
    celebrationQueue.length > 0 ||
    Boolean(topCutReveal) ||
    Boolean(phaseTransitionReveal);

  const canUseCurrentOrigin = Boolean(browserOrigin) && !isLocalhostLike(browserOrigin);
  const needsPublicUrlGate = needsNetworkUrlRefresh(
    state.config.publicBaseUrl,
    networkBaseUrls,
  );
  const registrationUrl = getRegistrationUrl(state.config.publicBaseUrl, browserOrigin);
  const hasMobileAdmin = Boolean(state.adminDeviceId);
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

  useEffect(() => {
    if (!seenCelebrationIdsRef.current) {
      const seenIds = readSeenCelebrationIds();
      for (const id of getExistingCelebrationIds(initialState)) {
        seenIds.add(id);
      }
      seenCelebrationIdsRef.current = seenIds;
      previousStateRef.current = initialState;
      latestStateRef.current = initialState;
      writeSeenCelebrationIds(seenIds);
    }
  }, [initialState]);

  useEffect(() => {
    activeCelebrationRef.current = activeCelebration;
  }, [activeCelebration]);

  useEffect(() => {
    celebrationQueueRef.current = celebrationQueue;
  }, [celebrationQueue]);

  useEffect(() => {
    const unlockAudio = (): void => {
      audio.unlock();
    };

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });

    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [audio]);

  function startCelebrationEvents(events: CelebrationEvent[], force = false): void {
    if (events.length === 0) {
      return;
    }

    const seenIds = seenCelebrationIdsRef.current ?? readSeenCelebrationIds();
    seenCelebrationIdsRef.current = seenIds;
    const activeEvent = activeCelebrationRef.current;
    const queuedEvents = celebrationQueueRef.current;
    const alreadyScheduled = new Set([
      activeEvent?.id,
      ...queuedEvents.map((entry) => entry.id),
    ]);
    const nextEvents: CelebrationEvent[] = [];

    for (const event of events) {
      if ((!force && seenIds.has(event.id)) || alreadyScheduled.has(event.id)) {
        continue;
      }

      seenIds.add(event.id);
      alreadyScheduled.add(event.id);
      nextEvents.push(event);
    }

    if (nextEvents.length === 0) {
      return;
    }

    writeSeenCelebrationIds(seenIds);

    if (!activeEvent) {
      const [firstEvent, ...restEvents] = nextEvents;
      const nextQueue = [...queuedEvents, ...restEvents];
      activeCelebrationRef.current = firstEvent;
      celebrationQueueRef.current = nextQueue;
      setActiveCelebration(firstEvent);
      setCelebrationQueue(nextQueue);
      return;
    }

    const nextQueue = [...queuedEvents, ...nextEvents];
    celebrationQueueRef.current = nextQueue;
    setCelebrationQueue(nextQueue);
  }

  function queueCelebrationEvent(event: CelebrationEvent, force = false): void {
    startCelebrationEvents([event], force);
  }

  function queueCompletedMatchCelebration(nextState: TournamentState, matchId: string): void {
    const match = nextState.matches.find((entry) => entry.id === matchId);
    const event = match ? buildMatchClosedCelebrationEvent(nextState, match) : null;

    if (!event) {
      return;
    }

    queueCelebrationEvent(event);
  }

  function queueChampionCelebration(nextState: TournamentState): void {
    const event = buildChampionCelebrationEvent(nextState);

    if (!event) {
      return;
    }

    queueCelebrationEvent(event);
  }

  function getSemifinalTransitionTeams(sourceState: TournamentState): Team[] {
    return getSemifinalRevealItems(sourceState)
      .slice(0, TOP_CUT)
      .map(({ team }) => team);
  }

  function getFinalTransitionTeams(sourceState: TournamentState): Team[] {
    const finalMatch = sourceState.matches.find((match) => match.stage === "final");
    const teamsById = new Map(sourceState.teams.map((entry) => [entry.id, entry]));

    return [finalMatch?.teamAId, finalMatch?.teamBId]
      .map((teamId) => (teamId ? teamsById.get(teamId) ?? null : null))
      .filter((entry): entry is Team => Boolean(entry));
  }

  function getLeagueSemifinalTransitionTeams(sourceState: TournamentState): Team[] {
    const teamsById = new Map(sourceState.teams.map((entry) => [entry.id, entry]));

    return sourceState.matches
      .filter((match) => match.stage === "leagueSemifinal")
      .sort((left, right) => left.table - right.table)
      .flatMap((match) => [match.teamAId, match.teamBId])
      .map((teamId) => (teamId ? teamsById.get(teamId) ?? null : null))
      .filter((entry): entry is Team => Boolean(entry));
  }

  function getLeagueFinalTransitionTeams(sourceState: TournamentState): Team[] {
    const teamsById = new Map(sourceState.teams.map((entry) => [entry.id, entry]));

    return sourceState.matches
      .filter((match) => match.stage === "leagueFinal")
      .sort((left, right) => left.table - right.table)
      .flatMap((match) => [match.teamAId, match.teamBId])
      .map((teamId) => (teamId ? teamsById.get(teamId) ?? null : null))
      .filter((entry): entry is Team => Boolean(entry));
  }

  function getProjectedLeagueFinalTransitionTeams(sourceState: TournamentState): Team[] {
    const ranked = getLeagueRankedTeams(sourceState);
    const projectedTeams: Team[] = [];

    const pushTier = (startIndex: number) => {
      const tierTeams = ranked.slice(startIndex, startIndex + TOP_CUT);

      if (tierTeams.length >= TOP_CUT) {
        projectedTeams.push(tierTeams[0], tierTeams[3], tierTeams[1], tierTeams[2]);
      }
    };

    if (sourceState.config.teamCount > 4) {
      pushTier(0);
    }

    if (sourceState.config.teamCount >= 8) {
      pushTier(4);
    }

    if (sourceState.config.teamCount >= 12) {
      pushTier(8);
    }

    return projectedTeams;
  }

  function applyTournamentState(nextState: TournamentState): void {
    const previousState = latestStateRef.current;
    const seenIds = seenCelebrationIdsRef.current ?? readSeenCelebrationIds();
    seenCelebrationIdsRef.current = seenIds;

    const events = getNewCelebrationEvents(previousState, nextState, seenIds);
    startCelebrationEvents(events);

    setForcedScreen((current) => {
      if (nextState.stage === "swiss") {
        return current === "swiss" ? current : "swiss";
      }

      if (nextState.stage === "league") {
        return current === "league" ? current : "league";
      }

      if (
        nextState.stage === "semifinals" ||
        nextState.stage === "final" ||
        nextState.stage === "leagueSemifinals" ||
        nextState.stage === "leagueFinals" ||
        nextState.stage === "completed"
      ) {
        return current === "topcut" ? current : "topcut";
      }

      if (current === "swiss" || current === "league" || current === "topcut") {
        return null;
      }

      return current;
    });

    if (previousState.stage !== nextState.stage) {
      if (suppressNextPhaseRevealRef.current) {
        suppressNextPhaseRevealRef.current = false;
      } else if (previousState.stage === "swiss" && nextState.stage === "semifinals") {
        const teams = getSemifinalTransitionTeams(nextState);

        if (teams.length >= TOP_CUT) {
          setPhaseTransitionReveal({
            mode: "swissToSemifinals",
            teams,
            nextAction: "none",
          });
        }
      } else if (previousState.stage === "semifinals" && nextState.stage === "final") {
        const teams = getFinalTransitionTeams(nextState);

        if (teams.length >= 2) {
          setPhaseTransitionReveal({
            mode: "semifinalsToFinal",
            teams: teams.slice(0, 2),
            nextAction: "none",
          });
        }
      } else if (previousState.stage === "league" && nextState.stage === "leagueSemifinals") {
        const teams = getLeagueSemifinalTransitionTeams(nextState);

        if (teams.length >= TOP_CUT) {
          setPhaseTransitionReveal({
            mode: "leagueToFinals",
            teams,
            nextAction: "none",
          });
        }
      } else if (
        previousState.stage === "leagueSemifinals" &&
        nextState.stage === "leagueFinals"
      ) {
        const teams = getLeagueFinalTransitionTeams(nextState);

        if (teams.length >= 2) {
          setPhaseTransitionReveal({
            mode: "leagueSemifinalsToFinals",
            teams,
            nextAction: "none",
          });
        }
      }
    }

    previousStateRef.current = nextState;
    latestStateRef.current = nextState;
    setState(nextState);
  }

  useEffect(() => {
    applyTournamentStateRef.current = applyTournamentState;
  });

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

      applyTournamentState(nextState);
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
    const syncVisibleSnapshot = () => {
      if (document.visibilityState === "visible") {
        void fetch("/api/tournament", { cache: "no-store" })
          .then((response) => response.json())
          .then((payload: TournamentState | { error: string }) => {
            if (!("error" in payload)) {
              applyTournamentStateRef.current(payload);
            }
          })
          .catch(() => undefined);
      }
    };

    syncVisibleSnapshot();

    const intervalId = window.setInterval(syncVisibleSnapshot, 1500);
    window.addEventListener("focus", syncVisibleSnapshot);
    document.addEventListener("visibilitychange", syncVisibleSnapshot);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", syncVisibleSnapshot);
      document.removeEventListener("visibilitychange", syncVisibleSnapshot);
    };
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

    applyTournamentState(nextState);
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
            leagueLoserBonusEnabled: setupForm.leagueLoserBonusEnabled,
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

  function handleDeleteParticipant(participant: Participant): void {
    const confirmed = window.confirm(
      `¿Eliminar a ${participant.name} del registro? Podrá volver a registrarse desde su móvil.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingParticipantId(participant.id);

    runMutation(
      () =>
        postAction({
          action: "deleteParticipantDuringSetup",
          payload: { participantId: participant.id },
        }),
      "Participante eliminado del registro.",
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
      structure.entryStage === "league"
        ? `Liga preparada. Se jugarán ${structure.swissRounds} rondas todos contra todos.`
        : structure.entryStage === "swiss"
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
        setForcedScreen(
          nextStructure.entryStage === "league"
            ? "league"
            : nextStructure.entryStage === "swiss"
              ? "swiss"
              : "topcut",
        );
        setActiveMatchId(null);
      },
    );
  }

  function executeAdvanceTournament(options: { suppressSemifinalReveal?: boolean } = {}): void {
    if (options.suppressSemifinalReveal) {
      suppressNextPhaseRevealRef.current = true;
    }

    runMutation(
      () => postAction({ action: "advancePhase" }),
      "Fase actualizada.",
      (nextState) => {
        queueChampionCelebration(nextState);
        if (
          !options.suppressSemifinalReveal &&
          state.stage === "swiss" &&
          nextState.stage === "semifinals"
        ) {
          const teams = getSemifinalTransitionTeams(nextState);

          if (teams.length >= TOP_CUT) {
            setPhaseTransitionReveal({
              mode: "swissToSemifinals",
              teams,
              nextAction: "none",
            });
          }
        }

        if (nextState.stage === "swiss") {
          setForcedScreen("swiss");
        } else if (
          nextState.stage === "semifinals" ||
          nextState.stage === "final" ||
          nextState.stage === "leagueSemifinals" ||
          nextState.stage === "leagueFinals"
        ) {
          setForcedScreen("topcut");
        } else {
          setForcedScreen(null);
        }
        setActiveMatchId(null);
      },
      () => {
        if (options.suppressSemifinalReveal) {
          suppressNextPhaseRevealRef.current = false;
        }
      },
    );
  }

  function handleAdvanceTournament(): void {
    if (celebrationLocked) {
      setFeedback({
        tone: "error",
        text: "Espera a que terminen las animaciones antes de cambiar de fase.",
      });
      return;
    }

    const structure = getTournamentStructure(state.config.teamCount, state.config.format);
    const semifinalRevealItems = getSemifinalRevealItems(state);
    const explicitTopCutItems = getTopCutFooterItems(state);

    if (
      state.stage === "swiss" &&
      structure.topCut > 0 &&
      semifinalRevealItems.length >= structure.topCut
    ) {
      try {
        const projectedState = advanceTournament(state);

        if (projectedState.stage === "semifinals") {
          const projectedRevealItems = getSemifinalRevealItems(projectedState);
          const revealItems =
            projectedRevealItems.length >= structure.topCut
              ? projectedRevealItems
              : semifinalRevealItems;

          setPhaseTransitionReveal({
            mode: "swissToSemifinals",
            teams: revealItems.slice(0, TOP_CUT).map(({ team }) => team),
            nextAction: "advance",
          });
          setFeedback(null);
          return;
        }
      } catch {
        if (explicitTopCutItems.length >= structure.topCut) {
          setPhaseTransitionReveal({
            mode: "swissToSemifinals",
            teams: semifinalRevealItems.slice(0, TOP_CUT).map(({ team }) => team),
            nextAction: "advance",
          });
          setFeedback(null);
          return;
        }
      }
    }

    if (state.stage === "semifinals") {
      const finalTeams = getCompletedSemifinalWinners(state);

      if (finalTeams.length >= 2) {
        setPhaseTransitionReveal({
          mode: "semifinalsToFinal",
          teams: finalTeams.slice(0, 2),
          nextAction: "advance",
        });
        setFeedback(null);
        return;
      }
    }

    if (state.stage === "leagueSemifinals") {
      const finalTeams = getCompletedSemifinalWinners(state);

      if (finalTeams.length >= 2) {
        setPhaseTransitionReveal({
          mode: "leagueSemifinalsToFinals",
          teams: finalTeams,
          nextAction: "advance",
        });
        setFeedback(null);
        return;
      }
    }

    executeAdvanceTournament();
  }

  function executeForceSemifinalsFromCurrentStandings(): void {
    runMutation(
      () => postAction({ action: "forceSemifinalsFromCurrentStandings" }),
      "Semifinales generadas con el Top 4 provisional.",
      () => {
        setForcedScreen("topcut");
        setActiveMatchId(null);
      },
    );
  }

  function handleForceSemifinalsFromCurrentStandings(): void {
    if (celebrationLocked) {
      setFeedback({
        tone: "error",
        text: "Espera a que terminen las animaciones antes de cambiar de fase.",
      });
      return;
    }

    let projectedSemifinalState: TournamentState;

    try {
      projectedSemifinalState = forceSemifinalsFromCurrentStandings(state);
    } catch (error) {
      setFeedback({ tone: "error", text: (error as Error).message });
      return;
    }

    const semifinalRevealItems = getSemifinalRevealItems(projectedSemifinalState);

    if (semifinalRevealItems.length >= TOP_CUT) {
      setPhaseTransitionReveal({
        mode: "swissToSemifinals",
        teams: semifinalRevealItems.slice(0, TOP_CUT).map(({ team }) => team),
        nextAction: "forceSemifinals",
      });
      setFeedback(null);
      return;
    }

    executeForceSemifinalsFromCurrentStandings();
  }

  function executeForceLeagueFinalsFromCurrentStandings(): void {
    runMutation(
      () => postAction({ action: "forceLeagueFinalsFromCurrentStandings" }),
      "Fases finales de liga generadas.",
      () => {
        setForcedScreen("topcut");
        setActiveMatchId(null);
      },
    );
  }

  function handleForceLeagueFinalsFromCurrentStandings(): void {
    if (celebrationLocked) {
      setFeedback({
        tone: "error",
        text: "Espera a que terminen las animaciones antes de cambiar de fase.",
      });
      return;
    }

    if (state.config.teamCount <= 4) {
      setFeedback({
        tone: "error",
        text: "Hace falta más de 4 parejas para jugar Champions League.",
      });
      return;
    }

    const teams = getProjectedLeagueFinalTransitionTeams(state);
    if (teams.length >= TOP_CUT) {
      setPhaseTransitionReveal({
        mode: "leagueToFinals",
        teams,
        nextAction: "forceLeagueFinals",
      });
      setFeedback(null);
      return;
    }

    executeForceLeagueFinalsFromCurrentStandings();
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
      async () => {
        const nextState = await postAction({
          action: "reportMatch",
          payload: {
            matchId: match.id,
            score: payload,
          },
        });

        if (match.stage === "final" && nextState.stage === "final") {
          return postAction({ action: "advancePhase" });
        }

        return nextState;
      },
      "Resultado guardado.",
      (nextState) => {
        if (match.stage === "final") {
          queueChampionCelebration(nextState);
        } else {
          queueCompletedMatchCelebration(nextState, match.id);
        }
        setActiveMatchId(null);
      },
    );
  }

  function handleCelebrationDone(): void {
    const [nextCelebration, ...remainingCelebrations] = celebrationQueueRef.current;
    celebrationQueueRef.current = remainingCelebrations;
    activeCelebrationRef.current = nextCelebration ?? null;
    setCelebrationQueue(remainingCelebrations);
    setActiveCelebration(nextCelebration ?? null);
  }

  function handleTopCutRevealDone(): void {
    const mode = topCutReveal?.mode;
    setTopCutReveal(null);

    if (mode === "advance") {
      executeAdvanceTournament();
    } else if (mode === "force") {
      executeForceSemifinalsFromCurrentStandings();
    }
  }

  function handlePhaseTransitionDone(): void {
    const nextAction = phaseTransitionReveal?.nextAction ?? "advance";
    setPhaseTransitionReveal(null);

    if (nextAction === "advance") {
      executeAdvanceTournament({ suppressSemifinalReveal: true });
      return;
    }

    if (nextAction === "forceSemifinals") {
      suppressNextPhaseRevealRef.current = true;
      executeForceSemifinalsFromCurrentStandings();
      return;
    }

    if (nextAction === "forceLeagueFinals") {
      suppressNextPhaseRevealRef.current = true;
      executeForceLeagueFinalsFromCurrentStandings();
    }
  }

  function handleRevealLeagueRound(): void {
    runMutation(
      () => postAction({ action: "revealLeagueRound" }),
      `Ronda ${state.currentSwissRound} sorteada.`,
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
        "Si vuelves al paso 3 se borrarán los emparejamientos y resultados actuales. ¿Continuar?",
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

  function handleReturnToSetup(): void {
    if (
      !window.confirm(
        "Si vuelves a configuración se borrarán las semifinales, final y resultados actuales. ¿Continuar?",
      )
    ) {
      return;
    }

    runMutation(
      () => postAction({ action: "returnToSetup" }),
      "Has vuelto a configuración.",
      () => {
        setForcedScreen("setup");
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

    if (state.stage === "league") {
      return `Liga en marcha. Ronda ${state.currentSwissRound} de ${state.swissRoundsPlanned}.`;
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

    if (state.stage === "league") {
      return "Continuar liga";
    }

    return "Continuar fase actual";
  }, [existingStateDetail, hasExistingProgress, state.stage]);
  const celebrationLayer = (
    <>
      <CelebrationAudioToggle audio={audio} />
      {activeCelebration?.kind === "matchClosed" ? (
        <MatchCelebrationOverlay
          event={activeCelebration}
          audio={audio}
          onDone={handleCelebrationDone}
        />
      ) : null}
      {activeCelebration?.kind === "champion" ? (
        <ChampionCelebrationOverlay
          event={activeCelebration}
          audio={audio}
          onDone={handleCelebrationDone}
        />
      ) : null}
      {topCutReveal ? (
        <TopCutRevealOverlay
          reveal={topCutReveal}
          audio={audio}
          onDone={handleTopCutRevealDone}
        />
      ) : null}
      {phaseTransitionReveal ? (
        <PhaseTransitionOverlay
          reveal={phaseTransitionReveal}
          audio={audio}
          onDone={handlePhaseTransitionDone}
        />
      ) : null}
    </>
  );

  const stageScreen: Screen =
    state.stage === "swiss"
      ? "swiss"
      : state.stage === "league"
        ? "league"
      : state.stage === "semifinals" ||
          state.stage === "final" ||
          state.stage === "leagueSemifinals" ||
          state.stage === "leagueFinals" ||
          state.stage === "completed"
        ? "topcut"
        : needsPublicUrlGate
          ? "url"
          : "setup";
  const validForcedScreen =
    state.stage === "setup"
      ? needsPublicUrlGate
        ? forcedScreen === "url"
        : forcedScreen === "setup" || forcedScreen === "url" || forcedScreen === "registration"
      : state.stage === "swiss"
        ? forcedScreen === "swiss"
        : state.stage === "league"
          ? forcedScreen === "league"
        : state.stage === "semifinals" ||
            state.stage === "final" ||
            state.stage === "leagueSemifinals" ||
            state.stage === "leagueFinals" ||
            state.stage === "completed"
          ? forcedScreen === "topcut"
          : false;
  const screen: Screen =
    forcedScreen && validForcedScreen
      ? forcedScreen
      : stageScreen;

  if (screen === "url") {
    return (
      <>
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
        {celebrationLayer}
      </>
    );
  }

  if (screen === "setup") {
    return (
      <>
        <TournamentSetupScreen
          form={setupForm}
          planSummary={planSummary}
          onChange={(patch) =>
            setSetupForm((current) => ({
              ...current,
              ...patch,
              targetPoints:
                patch.format === "league" && current.targetPoints !== "40"
                  ? "30"
                  : patch.format === "league"
                    ? current.targetPoints
                    : patch.targetPoints ?? current.targetPoints,
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
        {celebrationLayer}
      </>
    );
  }

  if (screen === "registration") {
    return (
      <>
        <RegistrationStageScreen
          state={state}
          registrationUrl={registrationUrl}
          onBack={() => {
            setForcedScreen("setup");
            setFeedback(null);
          }}
          onAddBotParticipant={handleAddBotParticipant}
          onRenameParticipant={handleRenameParticipant}
          onDeleteParticipant={handleDeleteParticipant}
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
        {celebrationLayer}
      </>
    );
  }

  if (screen === "swiss") {
    return (
      <>
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
          onForceSemifinals={handleForceSemifinalsFromCurrentStandings}
          onBack={handleBackFromSwiss}
          isPending={isPending}
          celebrationLocked={celebrationLocked}
          viewerMode={hasMobileAdmin}
          feedback={feedback}
        />
        {celebrationLayer}
      </>
    );
  }

  if (screen === "league") {
    return (
      <>
        <LeagueStageScreen
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
          onRevealRound={handleRevealLeagueRound}
          onOpenMatch={(matchId) => setActiveMatchId(matchId)}
          onCloseMatch={() => setActiveMatchId(null)}
          activeMatchId={activeMatchId}
          onAdvance={handleAdvanceTournament}
          onForceLeagueFinals={handleForceLeagueFinalsFromCurrentStandings}
          onBack={handleBackFromSwiss}
          isPending={isPending}
          celebrationLocked={celebrationLocked}
          viewerMode={hasMobileAdmin}
          feedback={feedback}
        />
        {celebrationLayer}
      </>
    );
  }

  if (state.stage === "completed") {
    return (
      <>
        <CompletedTournamentScreen
          state={state}
          onBack={handleReturnToSetup}
        />
        {celebrationLayer}
      </>
    );
  }

  return (
    <>
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
        onBack={handleReturnToSetup}
        isPending={isPending}
        isSyncing={isSyncing}
        celebrationLocked={celebrationLocked}
        viewerMode={hasMobileAdmin}
        feedback={feedback}
      />
      {celebrationLayer}
    </>
  );
}
