import { NextResponse } from "next/server";
import { mutateTournamentState, savePlayerPhoto } from "@/lib/store";
import { refreshTournamentState, updatePlayerPhoto } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const teamId = String(formData.get("teamId") ?? "");
    const slot = String(formData.get("slot") ?? "") as "A" | "B";
    const playerName = String(formData.get("playerName") ?? "");
    const file = formData.get("file");

    if (!teamId || (slot !== "A" && slot !== "B")) {
      throw new Error("Faltan datos del equipo o de la plaza del jugador.");
    }

    if (!(file instanceof File)) {
      throw new Error("No se ha recibido ninguna imagen.");
    }

    const savedFile = await savePlayerPhoto(file, teamId, slot);
    const photoUrl = `/api/uploads/${savedFile}`;
    const nextState = await mutateTournamentState((storedState) => {
      const current = refreshTournamentState(storedState);

      return updatePlayerPhoto(current, teamId, slot, photoUrl, playerName);
    });

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
