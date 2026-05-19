import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { TournamentState } from "@/lib/tournament";
import { createEmptyTournament } from "@/lib/tournament";

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), "data");

const STATE_FILE = path.join(DATA_DIR, "tournament.json");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
let mutationQueue: Promise<void> = Promise.resolve();

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
    adminDeviceId:
      typeof raw.adminDeviceId === "string" && raw.adminDeviceId.trim()
        ? raw.adminDeviceId
        : null,
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
  const tempFile = path.join(
    DATA_DIR,
    `.tournament-${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}.tmp`,
  );

  await writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
  await rename(tempFile, STATE_FILE);
  return state;
}

export async function mutateTournamentState(
  mutator: (state: TournamentState) => Promise<TournamentState> | TournamentState,
): Promise<TournamentState> {
  const run = mutationQueue.then(async () => {
    const current = await readTournamentState();
    const next = await mutator(current);
    return writeTournamentState(next);
  });

  mutationQueue = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

export async function clearUploadedPhotos(): Promise<void> {
  await ensureStorage();

  const entries = await readdir(UPLOADS_DIR, { withFileTypes: true });

  await Promise.all(
    entries.map((entry) =>
      rm(path.join(UPLOADS_DIR, entry.name), {
        force: true,
        recursive: entry.isDirectory(),
      }),
    ),
  );
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
    case "audio/webm":
      return ".webm";
    case "audio/mp4":
    case "audio/x-m4a":
      return ".m4a";
    case "audio/ogg":
      return ".ogg";
    case "audio/wav":
    case "audio/wave":
      return ".wav";
    case "video/mp4":
      return ".mp4";
    case "video/quicktime":
      return ".mov";
    case "video/webm":
      return ".webm";
    default:
      return mimeType.startsWith("audio/") ? ".webm" : ".jpg";
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

export async function saveChatAudio(
  file: File,
  participantOrDeviceId: string,
): Promise<string> {
  if (!file.type.startsWith("audio/") && !file.type.startsWith("video/")) {
    throw new Error("Solo se permiten audios o vídeos cortos con audio.");
  }

  await ensureStorage();

  const extension = getExtensionForMimeType(file.type);
  const safePrefix = participantOrDeviceId.replace(/[^a-zA-Z0-9-_]/g, "-");
  const fileName = `${safePrefix}-audio-${Date.now()}${extension}`;
  const filePath = path.join(UPLOADS_DIR, fileName);
  const bytes = Buffer.from(await file.arrayBuffer());

  if (bytes.byteLength > 25_000_000) {
    throw new Error("El audio es demasiado grande.");
  }

  await writeFile(filePath, bytes);

  return fileName;
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
    case ".webm":
      return "audio/webm";
    case ".m4a":
      return "audio/mp4";
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".ogg":
      return "audio/ogg";
    case ".wav":
      return "audio/wav";
    case ".jpg":
    case ".jpeg":
    default:
      return "image/jpeg";
  }
}
