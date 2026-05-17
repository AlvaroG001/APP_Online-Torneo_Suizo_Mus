import { NextResponse } from "next/server";
import {
  clearUploadedPhotos,
  mutateTournamentState,
  readTournamentState,
} from "@/lib/store";
import {
  addBotParticipant,
  advanceTournament,
  assignParticipantToTeamSlot,
  buildTournament,
  confirmManualTeam,
  createRandomTeams,
  deleteBotParticipantDuringSetup,
  deleteParticipantDuringSetup,
  forceSemifinalsFromCurrentStandings,
  postChatMessage,
  prepareManualTeams,
  renameParticipantDuringSetup,
  recordMatchResult,
  refreshTournamentState,
  returnToSetupPreparation,
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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action: string;
      payload?: unknown;
    };

    const nextState = await mutateTournamentState(async (storedState) => {
      const current = refreshTournamentState(storedState);

      switch (body.action) {
        case "reset":
          await clearUploadedPhotos();
          return buildTournament(body.payload as Parameters<typeof buildTournament>[0]);
        case "setPublicBaseUrl":
          return setPublicBaseUrl(
            current,
            String((body.payload as { publicBaseUrl?: string })?.publicBaseUrl ?? ""),
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
        case "setTeamCustomName":
          return setTeamCustomName(
            current,
            body.payload as Parameters<typeof setTeamCustomName>[1],
          );
        case "revealSwissGroup":
          return revealSwissGroup(
            current,
            String((body.payload as { bracketLabel?: string })?.bracketLabel ?? ""),
          );
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
