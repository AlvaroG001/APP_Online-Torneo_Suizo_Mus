import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TournamentState } from "@/lib/tournament";
import { createEmptyTournament } from "@/lib/tournament";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const STATE_FILE = path.join(DATA_DIR, "tournament.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

async function ensureStorage(): Promise<void> {
  await mkdir(UPLOADS_DIR, { recursive: true });
}

function sanitizeState(raw: Partial<TournamentState>): TournamentState {
  const base = createEmptyTournament();

  return {
    ...base,
    ...raw,
    config: {
      ...base.config,
      ...(raw.config ?? {}),
    },
    participants: Array.isArray(raw.participants)
      ? raw.participants
      : base.participants,
    teams: Array.isArray(raw.teams) ? raw.teams : base.teams,
    matches: Array.isArray(raw.matches) ? raw.matches : base.matches,
    chatMessages: Array.isArray(raw.chatMessages)
      ? raw.chatMessages
      : base.chatMessages,
    teamCreationMode:
      raw.teamCreationMode === "random" || raw.teamCreationMode === "manual"
        ? raw.teamCreationMode
        : base.teamCreationMode,
  };
}

export async function readTournamentState(): Promise<TournamentState> {
  await ensureStorage();

  try {
    const raw = await readFile(STATE_FILE, "utf8");
    return sanitizeState(JSON.parse(raw) as Partial<TournamentState>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return createEmptyTournament();
    }

    throw error;
  }
}

export async function writeTournamentState(
  state: TournamentState,
): Promise<TournamentState> {
  await ensureStorage();
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  return state;
}

function getExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "image/heic":
    case "image/heif":
      return ".heic";
    default:
      return ".jpg";
  }
}

export async function savePlayerPhoto(
  file: File,
  teamId: string,
  slot: "A" | "B",
): Promise<string> {
  return saveUploadedPhoto(file, `${teamId}-${slot}`);
}

export async function saveParticipantPhoto(
  file: File,
  participantOrDeviceId: string,
): Promise<string> {
  return saveUploadedPhoto(file, participantOrDeviceId);
}

async function saveUploadedPhoto(file: File, prefix: string): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Solo se permiten imágenes.");
  }

  await ensureStorage();

  const extension = getExtensionForMimeType(file.type);
  const safePrefix = prefix.replace(/[^a-zA-Z0-9-_]/g, "-");
  const fileName = `${safePrefix}-${Date.now()}${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  await writeFile(filePath, bytes);

  return fileName;
}

export function getUploadFilePath(slug: string[]): string {
  const resolved = path.resolve(path.join(UPLOADS_DIR, ...slug));

  if (!resolved.startsWith(UPLOADS_DIR)) {
    throw new Error("Ruta de fichero no válida.");
  }

  return resolved;
}

export function getContentTypeForPath(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}
