import { NextResponse } from "next/server";
import { readTournamentState, writeTournamentState } from "@/lib/store";
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

    const current = refreshTournamentState(await readTournamentState());
    let nextState = current;

    switch (body.action) {
      case "reset":
        nextState = buildTournament(body.payload as Parameters<typeof buildTournament>[0]);
        break;
      case "setPublicBaseUrl":
        nextState = setPublicBaseUrl(
          current,
          String((body.payload as { publicBaseUrl?: string })?.publicBaseUrl ?? ""),
        );
        break;
      case "createRandomTeams":
        nextState = createRandomTeams(current);
        break;
      case "addBotParticipant":
        nextState = addBotParticipant(current);
        break;
      case "prepareManualTeams":
        nextState = prepareManualTeams(current);
        break;
      case "renameParticipantDuringSetup":
        nextState = renameParticipantDuringSetup(
          current,
          body.payload as Parameters<typeof renameParticipantDuringSetup>[1],
        );
        break;
      case "deleteBotParticipantDuringSetup":
        nextState = deleteBotParticipantDuringSetup(
          current,
          body.payload as Parameters<typeof deleteBotParticipantDuringSetup>[1],
        );
        break;
      case "deleteParticipantDuringSetup":
        nextState = deleteParticipantDuringSetup(
          current,
          body.payload as Parameters<typeof deleteParticipantDuringSetup>[1],
        );
        break;
      case "assignParticipantToTeamSlot":
        nextState = assignParticipantToTeamSlot(
          current,
          body.payload as Parameters<typeof assignParticipantToTeamSlot>[1],
        );
        break;
      case "confirmManualTeam":
        nextState = confirmManualTeam(
          current,
          body.payload as Parameters<typeof confirmManualTeam>[1],
        );
        break;
      case "postChatMessage":
        nextState = postChatMessage(
          current,
          body.payload as Parameters<typeof postChatMessage>[1],
        );
        break;
      case "setTeamCustomName":
        nextState = setTeamCustomName(
          current,
          body.payload as Parameters<typeof setTeamCustomName>[1],
        );
        break;
      case "revealSwissGroup":
        nextState = revealSwissGroup(
          current,
          String((body.payload as { bracketLabel?: string })?.bracketLabel ?? ""),
        );
        break;
      case "startTournament":
      case "startSwiss":
        nextState = startTournament(current);
        break;
      case "reportMatch":
        nextState = recordMatchResult(
          current,
          body.payload as Parameters<typeof recordMatchResult>[1],
        );
        break;
      case "submitMobileMatchResult":
        nextState = submitMobileMatchResult(
          current,
          body.payload as Parameters<typeof submitMobileMatchResult>[1],
        );
        break;
      case "advancePhase":
        nextState = advanceTournament(current);
        break;
      case "forceSemifinalsFromCurrentStandings":
        nextState = forceSemifinalsFromCurrentStandings(current);
        break;
      case "returnToSetup":
        nextState = returnToSetupPreparation(current);
        break;
      default:
        throw new Error("Acción desconocida.");
    }

    await writeTournamentState(nextState);
    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
