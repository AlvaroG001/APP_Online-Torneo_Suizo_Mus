import { NextResponse } from "next/server";
import {
  clearUploadedPhotos,
  mutateTournamentState,
  readTournamentState,
} from "@/lib/store";
import {
  addBotParticipant,
  adminSetTeamCustomName,
  advanceTournament,
  assignParticipantToTeamSlot,
  buildTournament,
  claimMobileAdmin,
  clearActiveRankingTieBreak,
  confirmManualTeam,
  createRandomTeams,
  deleteBotParticipantDuringSetup,
  deleteParticipantDuringSetup,
  forceSemifinalsFromCurrentStandings,
  forceLeagueFinalsFromCurrentStandings,
  postChatMessage,
  postChatAudioMessage,
  prepareManualTeams,
  renameParticipantDuringSetup,
  recordMatchResult,
  refreshTournamentState,
  returnToSetupPreparation,
  resolveRankingTieBreak,
  revealLeagueRound,
  revealSwissGroup,
  setPublicBaseUrl,
  setTeamCustomName,
  startTournament,
  submitMobileMatchResult,
} from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = refreshTournamentState(await readTournamentState());
  return NextResponse.json(state);
}

const ADMIN_PROTECTED_ACTIONS = new Set([
  "revealSwissGroup",
  "reportMatch",
  "advancePhase",
  "forceSemifinalsFromCurrentStandings",
  "forceLeagueFinalsFromCurrentStandings",
  "revealLeagueRound",
  "adminSetTeamCustomName",
]);

function getAdminDeviceId(body: { adminDeviceId?: unknown; payload?: unknown }): string {
  const payload = body.payload as { adminDeviceId?: unknown } | null | undefined;
  return String(body.adminDeviceId ?? payload?.adminDeviceId ?? "").trim();
}

function assertAdminAllowed(
  current: ReturnType<typeof refreshTournamentState>,
  action: string,
  body: { adminDeviceId?: unknown; payload?: unknown },
): void {
  if (!current.adminDeviceId || !ADMIN_PROTECTED_ACTIONS.has(action)) {
    return;
  }

  if (getAdminDeviceId(body) !== current.adminDeviceId) {
    throw new Error("Esta accion esta reservada al movil admin.");
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: string;
      payload?: unknown;
      adminDeviceId?: unknown;
    };

    const nextState = await mutateTournamentState(async (storedState) => {
      const current = refreshTournamentState(storedState);
      assertAdminAllowed(current, body.action, body);

      switch (body.action) {
        case "reset":
          await clearUploadedPhotos();
          return buildTournament(body.payload as Parameters<typeof buildTournament>[0]);
        case "setPublicBaseUrl":
          return setPublicBaseUrl(
            current,
            String((body.payload as { publicBaseUrl?: string })?.publicBaseUrl ?? ""),
          );
        case "claimMobileAdmin":
          return claimMobileAdmin(
            current,
            body.payload as Parameters<typeof claimMobileAdmin>[1],
          );
        case "createRandomTeams":
          return createRandomTeams(current);
        case "addBotParticipant":
          return addBotParticipant(current);
        case "prepareManualTeams":
          return prepareManualTeams(current);
        case "renameParticipantDuringSetup":
          return renameParticipantDuringSetup(
            current,
            body.payload as Parameters<typeof renameParticipantDuringSetup>[1],
          );
        case "deleteBotParticipantDuringSetup":
          return deleteBotParticipantDuringSetup(
            current,
            body.payload as Parameters<typeof deleteBotParticipantDuringSetup>[1],
          );
        case "deleteParticipantDuringSetup":
          return deleteParticipantDuringSetup(
            current,
            body.payload as Parameters<typeof deleteParticipantDuringSetup>[1],
          );
        case "assignParticipantToTeamSlot":
          return assignParticipantToTeamSlot(
            current,
            body.payload as Parameters<typeof assignParticipantToTeamSlot>[1],
          );
        case "confirmManualTeam":
          return confirmManualTeam(
            current,
            body.payload as Parameters<typeof confirmManualTeam>[1],
          );
        case "postChatMessage":
          return postChatMessage(
            current,
            body.payload as Parameters<typeof postChatMessage>[1],
          );
        case "postChatAudioMessage":
          return postChatAudioMessage(
            current,
            body.payload as Parameters<typeof postChatAudioMessage>[1],
          );
        case "setTeamCustomName":
          return setTeamCustomName(
            current,
            body.payload as Parameters<typeof setTeamCustomName>[1],
          );
        case "adminSetTeamCustomName":
          return adminSetTeamCustomName(
            current,
            body.payload as Parameters<typeof adminSetTeamCustomName>[1],
          );
        case "resolveRankingTieBreak":
          return resolveRankingTieBreak(
            current,
            body.payload as Parameters<typeof resolveRankingTieBreak>[1],
          );
        case "clearActiveRankingTieBreak":
          return clearActiveRankingTieBreak(current);
        case "revealSwissGroup":
          return revealSwissGroup(
            current,
            String((body.payload as { bracketLabel?: string })?.bracketLabel ?? ""),
          );
        case "revealLeagueRound":
          return revealLeagueRound(current);
        case "startTournament":
        case "startSwiss":
          return startTournament(current);
        case "reportMatch":
          return recordMatchResult(
            current,
            body.payload as Parameters<typeof recordMatchResult>[1],
          );
        case "submitMobileMatchResult":
          return submitMobileMatchResult(
            current,
            body.payload as Parameters<typeof submitMobileMatchResult>[1],
          );
        case "advancePhase":
          return advanceTournament(current);
        case "forceSemifinalsFromCurrentStandings":
          return forceSemifinalsFromCurrentStandings(current);
        case "forceLeagueFinalsFromCurrentStandings":
          return forceLeagueFinalsFromCurrentStandings(current);
        case "returnToSetup":
          return returnToSetupPreparation(current);
        default:
          throw new Error("Acción desconocida.");
      }
    });

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
