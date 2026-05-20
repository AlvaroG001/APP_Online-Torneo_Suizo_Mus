import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";

const port = Number(process.env.PORT ?? 3000);
const localUrl = `http://127.0.0.1:${port}`;
const tunnelUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi;

const children = new Set();
let shuttingDown = false;
let tunnelUrl = "";

function log(prefix, chunk) {
  const text = chunk.toString();
  process.stdout.write(
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => `[${prefix}] ${line}\n`)
      .join(""),
  );
  return text;
}

function startProcess(prefix, command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    ...options,
  });

  children.add(child);
  child.stdout.on("data", (chunk) => handleOutput(prefix, chunk));
  child.stderr.on("data", (chunk) => handleOutput(prefix, chunk));
  child.on("exit", (code, signal) => {
    children.delete(child);

    if (!shuttingDown && code !== 0) {
      console.error(`[${prefix}] proceso terminado con código ${code ?? signal}`);
      shutdown(1);
    }
  });

  return child;
}

function handleOutput(prefix, chunk) {
  const text = log(prefix, chunk);
  const urls = text.match(tunnelUrlPattern);

  if (!urls?.length || tunnelUrl) {
    return;
  }

  tunnelUrl = urls[0].replace(/\/+$/, "");
  void setTournamentPublicUrl(tunnelUrl);
}

async function waitForLocalServer() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await isLocalServerReady()) {
      return;
    }

    await wait(500);
  }

  throw new Error(`Next no ha respondido en ${localUrl}`);
}

async function isLocalServerReady() {
  try {
    const response = await fetch(`${localUrl}/api/tournament`, { cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function setTournamentPublicUrl(url) {
  try {
    const response = await fetch(`${localUrl}/api/tournament`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "setPublicBaseUrl",
        payload: { publicBaseUrl: url },
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.error ?? "No se ha podido guardar la URL HTTPS.");
    }

    console.log("\n[TUNNEL] URL HTTPS guardada para QR y móviles:");
    console.log(`[TUNNEL] ${url}`);
    console.log("[TUNNEL] Abre esta URL en los móviles para grabar audio directo.\n");
  } catch (error) {
    console.error(`[TUNNEL] No se ha podido guardar la URL HTTPS: ${error.message}`);
    console.error(`[TUNNEL] Copia manualmente esta URL en Paso 1: ${url}`);
  }
}

function shutdown(code = 0) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }

  setTimeout(() => process.exit(code), 350).unref();
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

try {
  if (await isLocalServerReady()) {
    console.log(`[NEXT] reutilizando servidor existente en ${localUrl}`);
  } else {
    console.log(`[NEXT] arrancando en ${localUrl}`);
    startProcess("NEXT", "npm", ["run", "dev", "--", "--port", String(port)]);
  }

  await waitForLocalServer();
  console.log("[TUNNEL] arrancando Cloudflare Tunnel...");
  startProcess("TUNNEL", "npx", [
    "--yes",
    "cloudflared",
    "tunnel",
    "--url",
    localUrl,
    "--no-autoupdate",
  ]);
} catch (error) {
  console.error(`[TUNNEL] ${error.message}`);
  shutdown(1);
}
