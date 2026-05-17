import { NextResponse } from "next/server";
import {
  mutateTournamentState,
  saveParticipantPhoto,
} from "@/lib/store";
import { refreshTournamentState, registerParticipant } from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const deviceId = String(formData.get("deviceId") ?? "");
    const name = String(formData.get("name") ?? "");
    const file = formData.get("file");

    if (!deviceId.trim()) {
      throw new Error("No se ha podido identificar el móvil.");
    }

    if (!name.trim()) {
      throw new Error("El nombre es obligatorio.");
    }

    if (!(file instanceof File)) {
      throw new Error("La foto es obligatoria.");
    }

    const savedFile = await saveParticipantPhoto(file, deviceId.trim());
    const photoUrl = `/api/uploads/${savedFile}`;
    const nextState = await mutateTournamentState((storedState) => {
      const current = refreshTournamentState(storedState);

      return registerParticipant(current, {
        deviceId,
        name,
        photoUrl,
      });
    });

    return NextResponse.json(nextState);
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 400 },
    );
  }
}
