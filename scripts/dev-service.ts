#!/usr/bin/env -S node --import tsx
import { execFile } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
  forceKillLocalServiceProcessTree,
  isPidAlive,
  listLocalServiceRegistryRecords,
  removeLocalServiceRegistryRecord,
  terminateLocalService,
} from "../server/src/services/local-service-supervisor.ts";
import { getDevServiceControlFilePath, repoRoot } from "./dev-service-profile.ts";

const execFileAsync = promisify(execFile);

function toDisplayLines(records: Awaited<ReturnType<typeof listLocalServiceRegistryRecords>>) {
  return records.map((record) => {
    const childPid = typeof record.metadata?.childPid === "number" ? ` child=${record.metadata.childPid}` : "";
    const url = typeof record.metadata?.url === "string" ? ` url=${record.metadata.url}` : "";
    return `${record.serviceName} pid=${record.pid}${childPid} cwd=${record.cwd}${url}`;
  });
}

const command = process.argv[2] ?? "list";
const records = await listLocalServiceRegistryRecords({
  profileKind: "paperclip-dev",
  metadata: { repoRoot },
});

function getRecordChildPid(record: (typeof records)[number]) {
  return typeof record.metadata?.childPid === "number" && record.metadata.childPid > 0
    ? record.metadata.childPid
    : null;
}

async function isDevServiceHealthy(port: number | null) {
  if (!port || port <= 0) return false;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(1_500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function findListeningPid(port: number | null) {
  if (!port || port <= 0) return null;

  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], {
      windowsHide: true,
    });

    const match = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => {
        const parts = line.split(/\s+/);
        return (
          parts.length >= 5 &&
          /^tcp$/i.test(parts[0]) &&
          parts[1]?.endsWith(`:${port}`) &&
          /^listening$/i.test(parts[3])
        );
      });

    if (!match) return null;
    const pid = Number.parseInt(match.split(/\s+/).at(-1) ?? "", 10);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

async function stopRecordGracefullyOnWindows(record: (typeof records)[number]) {
  const controlFilePath = getDevServiceControlFilePath(record.serviceKey);
  const childPid = getRecordChildPid(record);

  mkdirSync(path.dirname(controlFilePath), { recursive: true });
  writeFileSync(
    controlFilePath,
    `${JSON.stringify({ requestedAt: new Date().toISOString(), command: "stop" })}\n`,
    "utf8",
  );

  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const wrapperAlive = isPidAlive(record.pid);
    const childAlive = childPid ? isPidAlive(childPid) : false;
    const serviceHealthy = await isDevServiceHealthy(record.port);

    if (!wrapperAlive && !childAlive && !serviceHealthy) {
      rmSync(controlFilePath, { force: true });
      return;
    }
    await delay(200);
  }

  rmSync(controlFilePath, { force: true });
  if (childPid && isPidAlive(childPid)) {
    await forceKillLocalServiceProcessTree({ pid: childPid, processGroupId: null });
  }
  if (isPidAlive(record.pid)) {
    await forceKillLocalServiceProcessTree(record);
  }
  const listeningPid = await findListeningPid(record.port);
  if (listeningPid && isPidAlive(listeningPid)) {
    await forceKillLocalServiceProcessTree({ pid: listeningPid, processGroupId: null });
  }
}

if (command === "list") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }
  for (const line of toDisplayLines(records)) {
    console.log(line);
  }
  process.exit(0);
}

if (command === "stop") {
  if (records.length === 0) {
    console.log("No Paperclip dev services registered for this repo.");
    process.exit(0);
  }
  for (const record of records) {
    if (process.platform === "win32") {
      await stopRecordGracefullyOnWindows(record);
    } else {
      await terminateLocalService(record);
    }
    await removeLocalServiceRegistryRecord(record.serviceKey);
    console.log(`Stopped ${record.serviceName} (pid ${record.pid})`);
  }
  process.exit(0);
}

console.error(`Unknown dev-service command: ${command}`);
process.exit(1);
