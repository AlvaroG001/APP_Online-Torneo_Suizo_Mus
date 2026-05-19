import { NextResponse } from "next/server";
import {
  mutateTournamentState,
  saveChatAudio,
} from "@/lib/store";
import {
  MAX_CHAT_AUDIO_DURATION_MS,
  postChatAudioMessage,
  refreshTournamentState,
} from "@/lib/tournament";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const deviceId = String(formData.get("deviceId") ?? "");
    const durationMs = Number(formData.get("durationMs") ?? 0);
    const file = formData.get("file");

    if (!deviceId.trim()) {
      throw new Error("No se ha podido identificar el móvil.");
    }

    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_CHAT_AUDIO_DURATION_MS + 500) {
      throw new Error("El audio debe durar 5 segundos o menos.");
    }

    if (!(file instanceof File)) {
      throw new Error("El audio es obligatorio.");
    }

    const savedFile = await saveChatAudio(file, deviceId.trim());
    const audioUrl = `/api/uploads/${savedFile}`;
    const nextState = await mutateTournamentState((storedState) => {
      const current = refreshTournamentState(storedState);

      return postChatAudioMessage(current, {
        deviceId,
        audioUrl,
        durationMs,
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
