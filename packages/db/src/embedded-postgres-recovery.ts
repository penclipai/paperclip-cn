import { existsSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SHARED_MEMORY_IN_USE_PATTERN = /pre-existing shared memory block is still in use/i;

function normalizeForMatch(value: string): string {
  const normalized = path.resolve(value).replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function normalizeTextForMatch(value: string): string {
  const normalized = value.replace(/\\/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesDataDir(commandLine: string, dataDir: string): boolean {
  const normalizedCommand = normalizeTextForMatch(commandLine);
  const escapedDataDir = escapeRegExp(normalizeForMatch(dataDir));
  return new RegExp(`(?:^|[\\s"'=])${escapedDataDir}(?=$|[\\s"'=])`).test(normalizedCommand);
}

async function listPostgresProcesses(): Promise<Array<{ pid: number; commandLine: string }>> {
  if (process.platform === "win32") {
    const { stdout } = await execFileAsync(
      "powershell",
      [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "Get-CimInstance Win32_Process -Filter \"name = 'postgres.exe'\" | " +
          "Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { windowsHide: true },
    );

    const payload = stdout.trim();
    if (!payload) return [];
    const parsed = JSON.parse(payload) as
      | { ProcessId?: number; CommandLine?: string | null }
      | Array<{ ProcessId?: number; CommandLine?: string | null }>;
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((row) => ({
        pid: Number(row.ProcessId),
        commandLine: typeof row.CommandLine === "string" ? row.CommandLine : "",
      }))
      .filter((row) => Number.isInteger(row.pid) && row.pid > 0);
  }

  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="]);
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.*)$/);
      if (!match) return null;
      return {
        pid: Number(match[1]),
        commandLine: match[2] ?? "",
      };
    })
    .filter((row): row is { pid: number; commandLine: string } => row !== null)
    .filter((row) => /\bpostgres\b/i.test(row.commandLine));
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  }
  return false;
}

async function terminateProcess(pid: number): Promise<boolean> {
  try {
    process.kill(pid);
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
  return await waitForProcessExit(pid, 2_000);
}

export function shouldRetryEmbeddedPostgresStart(recentLogs: string[]): boolean {
  return recentLogs.some((line) => SHARED_MEMORY_IN_USE_PATTERN.test(line));
}

export async function recoverEmbeddedPostgresStart(dataDir: string): Promise<number[]> {
  const matchingProcesses = (await listPostgresProcesses())
    .filter((processInfo) => matchesDataDir(processInfo.commandLine, dataDir))
    .map((processInfo) => processInfo.pid);

  const terminated: number[] = [];
  for (const pid of matchingProcesses) {
    if (await terminateProcess(pid)) {
      terminated.push(pid);
    }
  }

  const postmasterPidFile = path.resolve(dataDir, "postmaster.pid");
  if (terminated.length === matchingProcesses.length && existsSync(postmasterPidFile)) {
    rmSync(postmasterPidFile, { force: true });
  }

  return terminated;
}
