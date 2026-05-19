#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { spawn } from "node:child_process";

const execFileAsync = promisify(execFile);

const DEFAULTS = {
  users: 50,
  port: 3100,
  dataDir: ".stress-data",
  pollSeconds: 600,
  chatSeconds: 120,
  chatEveryMs: 5000,
  pollEveryMs: 4000,
  timeoutMs: 15000,
  photoKb: 150,
  baseUrl: "",
  spawnServer: false,
  format: "swiss_top4",
};

function parseArgs() {
  const options = { ...DEFAULTS };

  for (const rawArg of process.argv.slice(2)) {
    const [name, value = ""] = rawArg.split("=");

    switch (name) {
      case "--base-url":
        options.baseUrl = value.replace(/\/+$/, "");
        break;
      case "--users":
        options.users = Number(value);
        break;
      case "--port":
        options.port = Number(value);
        break;
      case "--data-dir":
        options.dataDir = value;
        break;
      case "--poll-seconds":
        options.pollSeconds = Number(value);
        break;
      case "--chat-seconds":
        options.chatSeconds = Number(value);
        break;
      case "--chat-every-ms":
        options.chatEveryMs = Number(value);
        break;
      case "--poll-every-ms":
        options.pollEveryMs = Number(value);
        break;
      case "--timeout-ms":
        options.timeoutMs = Number(value);
        break;
      case "--photo-kb":
        options.photoKb = Number(value);
        break;
      case "--spawn":
        options.spawnServer = true;
        break;
      case "--format":
        options.format = value;
        break;
      default:
        throw new Error(`Argumento no soportado: ${rawArg}`);
    }
  }

  if (!Number.isInteger(options.users) || options.users < 2) {
    throw new Error("--users debe ser un número entero mayor que 1.");
  }

  if (options.users % 2 !== 0) {
    throw new Error("--users debe ser par para crear parejas completas.");
  }

  if (!options.baseUrl) {
    options.baseUrl = `http://127.0.0.1:${options.port}`;
  }

  if (!["swiss_top4", "swiss_only", "league"].includes(options.format)) {
    throw new Error("--format debe ser swiss_top4, swiss_only o league.");
  }

  return options;
}

class Metrics {
  constructor() {
    this.entries = [];
    this.errors = [];
  }

  record(label, status, durationMs, ok, detail = "") {
    this.entries.push({ label, status, durationMs, ok });

    if (!ok) {
      this.errors.push({ label, status, durationMs, detail });
    }
  }

  summary(label = "global") {
    const durations = this.entries
      .map((entry) => entry.durationMs)
      .sort((left, right) => left - right);
    const byLabel = new Map();

    for (const entry of this.entries) {
      byLabel.set(entry.label, (byLabel.get(entry.label) ?? 0) + 1);
    }

    return {
      label,
      requests: this.entries.length,
      errors: this.errors.length,
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: durations.at(-1) ?? 0,
      byLabel: Object.fromEntries([...byLabel.entries()].sort()),
    };
  }
}

function percentile(sortedValues, percentileValue) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const index = Math.ceil((percentileValue / 100) * sortedValues.length) - 1;
  return Math.round(sortedValues[Math.max(0, Math.min(index, sortedValues.length - 1))]);
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) {
    return "n/a";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

async function requestJson(metrics, baseUrl, label, pathName, init = {}, timeoutMs) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathName}`, {
      ...init,
      signal: controller.signal,
    });
    const text = await response.text();
    const durationMs = performance.now() - startedAt;
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text };
    }

    const ok = response.ok && !(payload && typeof payload === "object" && "error" in payload);
    metrics.record(
      label,
      response.status,
      durationMs,
      ok,
      ok ? "" : JSON.stringify(payload).slice(0, 500),
    );

    if (!ok) {
      throw new Error(`${label} ${response.status}: ${JSON.stringify(payload)}`);
    }

    return payload;
  } catch (error) {
    const durationMs = performance.now() - startedAt;
    metrics.record(label, 0, durationMs, false, error.message);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestBinary(metrics, baseUrl, label, pathName, timeoutMs) {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${pathName}`, {
      signal: controller.signal,
    });
    await response.arrayBuffer();
    metrics.record(label, response.status, performance.now() - startedAt, response.ok);
  } catch (error) {
    metrics.record(label, 0, performance.now() - startedAt, false, error.message);
  } finally {
    clearTimeout(timeout);
  }
}

function postAction(metrics, baseUrl, action, payload, timeoutMs) {
  return requestJson(
    metrics,
    baseUrl,
    `POST ${action}`,
    "/api/tournament",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    },
    timeoutMs,
  );
}

function makeFakeImageBlob(kilobytes) {
  const size = Math.max(1, kilobytes) * 1024;
  const bytes = new Uint8Array(size);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = (index * 31 + 17) % 251;
  }

  return new Blob([bytes], { type: "image/jpeg" });
}

async function registerDevice(metrics, baseUrl, device, photoBlob, timeoutMs) {
  const formData = new FormData();
  formData.set("deviceId", device.deviceId);
  formData.set("name", device.name);
  formData.set("file", photoBlob, `${device.deviceId}.jpg`);

  return requestJson(
    metrics,
    baseUrl,
    "POST register",
    "/api/tournament/register",
    {
      method: "POST",
      body: formData,
    },
    timeoutMs,
  );
}

async function runPool(items, concurrency, worker) {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex];
      nextIndex += 1;
      await worker(item);
    }
  });

  await Promise.all(workers);
}

async function pollLoop(metrics, baseUrl, label, durationMs, everyMs, timeoutMs) {
  const endAt = Date.now() + durationMs;

  while (Date.now() < endAt) {
    await requestJson(metrics, baseUrl, label, "/api/tournament", {}, timeoutMs).catch(
      () => undefined,
    );
    await sleep(everyMs);
  }
}

async function chatLoop(metrics, baseUrl, devices, durationMs, everyMs, timeoutMs) {
  const endAt = Date.now() + durationMs;
  let tick = 0;

  while (Date.now() < endAt) {
    tick += 1;
    await Promise.all(
      devices.map((device) =>
        postAction(
          metrics,
          baseUrl,
          "postChatMessage",
          {
            deviceId: device.deviceId,
            text: `stress ${tick} ${device.name}`,
          },
          timeoutMs,
        ).catch(() => undefined),
      ),
    );
    await sleep(everyMs);
  }
}

async function photoReadLoop(metrics, baseUrl, photoUrls, durationMs, timeoutMs) {
  const endAt = Date.now() + durationMs;

  while (Date.now() < endAt) {
    await Promise.all(
      photoUrls.map((photoUrl) =>
        requestBinary(metrics, baseUrl, "GET photo", photoUrl, timeoutMs),
      ),
    );
    await sleep(1000);
  }
}

function getPlayableMatches(state) {
  return state.matches.filter(
    (match) =>
      (match.stage === "swiss" || match.stage === "league") &&
      match.revealed &&
      match.status === "pending" &&
      !match.bye &&
      match.teamAId &&
      match.teamBId,
  );
}

function getReporterDeviceId(state, teamId) {
  const team = state.teams.find((entry) => entry.id === teamId);
  const playerA = team?.players?.[0];
  const playerB = team?.players?.[1];
  const player = playerA?.deviceId?.startsWith("bot-") ? playerB : playerA;

  if (!player?.deviceId) {
    throw new Error(`No hay reporter para ${teamId}`);
  }

  return player.deviceId;
}

function winningScore() {
  return {
    teamA: { vacas: 0, games: 0, points: 30 },
    teamB: { vacas: 0, games: 0, points: 0 },
  };
}

function losingScore() {
  return {
    teamA: { vacas: 0, games: 0, points: 0 },
    teamB: { vacas: 0, games: 0, points: 30 },
  };
}

async function revealCurrentRound(metrics, baseUrl, state, timeoutMs) {
  if (state.stage === "league") {
    return postAction(
      metrics,
      baseUrl,
      "revealLeagueRound",
      undefined,
      timeoutMs,
    );
  }

  const labels = [
    ...new Set(
      state.matches
        .filter((match) => match.stage === "swiss" && match.roundIndex === state.currentSwissRound)
        .map((match) => match.bracketLabel),
    ),
  ];

  for (const bracketLabel of labels) {
    state = await postAction(
      metrics,
      baseUrl,
      "revealSwissGroup",
      { bracketLabel },
      timeoutMs,
    );
  }

  return state;
}

async function submitRoundResults(metrics, baseUrl, state, timeoutMs) {
  let matches = getPlayableMatches(state);

  if (matches.length === 0) {
    return state;
  }

  const conflictMatch = matches[0];
  const teamADeviceId = getReporterDeviceId(state, conflictMatch.teamAId);
  const teamBDeviceId = getReporterDeviceId(state, conflictMatch.teamBId);

  state = await postAction(
    metrics,
    baseUrl,
    "submitMobileMatchResult",
    { deviceId: teamADeviceId, matchId: conflictMatch.id, score: winningScore() },
    timeoutMs,
  );
  state = await postAction(
    metrics,
    baseUrl,
    "submitMobileMatchResult",
    { deviceId: teamBDeviceId, matchId: conflictMatch.id, score: losingScore() },
    timeoutMs,
  );
  state = await postAction(
    metrics,
    baseUrl,
    "submitMobileMatchResult",
    { deviceId: teamBDeviceId, matchId: conflictMatch.id, score: winningScore() },
    timeoutMs,
  );

  matches = getPlayableMatches(state);
  await Promise.all(
    matches.map(async (match) => {
      const reporterA = getReporterDeviceId(state, match.teamAId);
      const reporterB = getReporterDeviceId(state, match.teamBId);

      await postAction(
        metrics,
        baseUrl,
        "submitMobileMatchResult",
        { deviceId: reporterA, matchId: match.id, score: winningScore() },
        timeoutMs,
      );
      await postAction(
        metrics,
        baseUrl,
        "submitMobileMatchResult",
        { deviceId: reporterB, matchId: match.id, score: winningScore() },
        timeoutMs,
      );
    }),
  );

  return requestJson(metrics, baseUrl, "GET final-state", "/api/tournament", {}, timeoutMs);
}

async function waitForServer(baseUrl, timeoutMs) {
  const endAt = Date.now() + timeoutMs;

  while (Date.now() < endAt) {
    try {
      const response = await fetch(`${baseUrl}/api/tournament`);
      if (response.ok) {
        return;
      }
    } catch {
      // Reintento hasta que next start esté escuchando.
    }

    await sleep(500);
  }

  throw new Error(`El servidor no responde en ${baseUrl}`);
}

async function startServer(options) {
  if (!options.spawnServer) {
    return null;
  }

  await rm(options.dataDir, { force: true, recursive: true });
  await mkdir(options.dataDir, { recursive: true });

  const child = spawn(
    "npm",
    ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(options.port)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATA_DIR: path.resolve(options.dataDir),
        PORT: String(options.port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  child.stdout.on("data", (chunk) => process.stdout.write(`[next] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[next] ${chunk}`));
  await waitForServer(options.baseUrl, 30000);
  return child;
}

async function getRssMb(pid) {
  if (!pid) {
    return null;
  }

  try {
    const { stdout } = await execFileAsync("ps", ["-o", "rss=", "-p", String(pid)]);
    const rssKb = Number(stdout.trim());
    return Number.isFinite(rssKb) ? Math.round(rssKb / 1024) : null;
  } catch {
    return null;
  }
}

async function getStateFileSize(dataDir) {
  try {
    const fileStat = await stat(path.join(dataDir, "tournament.json"));
    return fileStat.size;
  } catch {
    return null;
  }
}

function assertCondition(assertions, condition, message) {
  assertions.push({ ok: Boolean(condition), message });
}

async function main() {
  const options = parseArgs();
  const metrics = new Metrics();
  const assertions = [];
  const devices = Array.from({ length: options.users }, (_, index) => ({
    deviceId: `stress-device-${String(index + 1).padStart(3, "0")}`,
    name: `Stress ${String(index + 1).padStart(3, "0")}`,
  }));
  let server = null;

  try {
    server = await startServer(options);
    const serverRssBefore = await getRssMb(server?.pid);

    console.log(`Stress target: ${options.baseUrl}`);
    console.log(`Usuarios: ${options.users}, parejas: ${options.users / 2}`);

    let state = await postAction(
      metrics,
      options.baseUrl,
      "reset",
      {
        title: "Stress Test",
        teamCount: options.users / 2,
        vacasPerMatch: 1,
        gamesPerVaca: 1,
        targetPoints: 30,
        publicBaseUrl: options.baseUrl,
        format: options.format,
      },
      options.timeoutMs,
    );

    const polling = Promise.all(
      [...devices, { deviceId: "admin", name: "Admin" }].map((device) =>
        pollLoop(
          metrics,
          options.baseUrl,
          `GET poll ${device.deviceId}`,
          options.pollSeconds * 1000,
          options.pollEveryMs,
          options.timeoutMs,
        ),
      ),
    );

    const photoBlob = makeFakeImageBlob(options.photoKb);
    await runPool(devices, options.users, (device) =>
      registerDevice(metrics, options.baseUrl, device, photoBlob, options.timeoutMs),
    );

    state = await requestJson(
      metrics,
      options.baseUrl,
      "GET after-register",
      "/api/tournament",
      {},
      options.timeoutMs,
    );
    const uniqueDeviceIds = new Set(state.participants.map((participant) => participant.deviceId));
    assertCondition(
      assertions,
      state.participants.length === options.users,
      `participantes esperados ${options.users}, reales ${state.participants.length}`,
    );
    assertCondition(
      assertions,
      uniqueDeviceIds.size === options.users,
      `deviceId únicos esperados ${options.users}, reales ${uniqueDeviceIds.size}`,
    );

    const photoUrls = state.participants.map((participant) => participant.photoUrl);
    const chat = chatLoop(
      metrics,
      options.baseUrl,
      devices,
      options.chatSeconds * 1000,
      options.chatEveryMs,
      options.timeoutMs,
    );
    const photoReads = photoReadLoop(
      metrics,
      options.baseUrl,
      photoUrls,
      Math.min(options.chatSeconds, 60) * 1000,
      options.timeoutMs,
    );

    await Promise.all([chat, photoReads]);

    state = await postAction(
      metrics,
      options.baseUrl,
      "createRandomTeams",
      undefined,
      options.timeoutMs,
    );
    assertCondition(
      assertions,
      state.teams.filter((team) => team.confirmed).length === options.users / 2,
      "parejas aleatorias confirmadas",
    );

    state = await postAction(
      metrics,
      options.baseUrl,
      "startTournament",
      undefined,
      options.timeoutMs,
    );
    state = await revealCurrentRound(metrics, options.baseUrl, state, options.timeoutMs);
    state = await submitRoundResults(metrics, options.baseUrl, state, options.timeoutMs);

    const pendingPlayable = getPlayableMatches(state).length;
    assertCondition(assertions, pendingPlayable === 0, `mesas pendientes tras resultados: ${pendingPlayable}`);

    await polling;

    state = await requestJson(
      metrics,
      options.baseUrl,
      "GET completed",
      "/api/tournament",
      {},
      options.timeoutMs,
    );
    assertCondition(
      assertions,
      state.chatMessages.length <= 200,
      `chat limitado a 200 mensajes, reales ${state.chatMessages.length}`,
    );

    const serverRssAfter = await getRssMb(server?.pid);
    const stateFileSize = await getStateFileSize(path.resolve(options.dataDir));
    const summary = metrics.summary("stress");
    const failedAssertions = assertions.filter((assertion) => !assertion.ok);

    console.log("\n=== Métricas ===");
    console.log(JSON.stringify(summary, null, 2));
    console.log("\n=== Recursos ===");
    console.log(
      JSON.stringify(
        {
          serverRssBeforeMb: serverRssBefore,
          serverRssAfterMb: serverRssAfter,
          stateFileSize: formatBytes(stateFileSize),
          dataDir: path.resolve(options.dataDir),
        },
        null,
        2,
      ),
    );
    console.log("\n=== Validaciones ===");
    for (const assertion of assertions) {
      console.log(`${assertion.ok ? "OK" : "FAIL"} ${assertion.message}`);
    }

    if (metrics.errors.length > 0) {
      console.log("\n=== Primeros errores ===");
      console.log(JSON.stringify(metrics.errors.slice(0, 10), null, 2));
    }

    if (failedAssertions.length > 0 || metrics.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
