import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { RailwayError, type RailwaySshInput } from "./railway.js";
import { redactSensitiveText } from "../redaction.js";

export const RAILWAY_SSH_SECRET_PATH = "railway.ssh_private_key";

/**
 * Uses only Paperclip's fixed OpenSSH locations. In particular, do not fall
 * back to PATH here: Railway commands must not inherit a developer's SSH
 * wrapper, configuration, agent, or provider credentials.
 */
export function resolveRailwayOpenSshPath(
  command: "ssh" | "ssh-keygen",
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string | null {
  if (platform !== "win32") return `/usr/bin/${command}`;

  for (const programFiles of [environment.ProgramFiles, environment["ProgramFiles(x86)"]]) {
    if (!programFiles) continue;
    const candidate = path.join(programFiles, "Git", "usr", "bin", `${command}.exe`);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function railwayMsysPath(value: string): string {
  // Git for Windows' OpenSSH is an MSYS executable. Forward slashes retain
  // the drive prefix while avoiding backslash escaping in its POSIX path args.
  return process.platform === "win32" ? value.replace(/\\/g, "/") : value;
}

export function validateRailwayKnownHosts(value: string): string {
  if (value.length > 8192) throw new RailwayError("railway_ssh_host_key_invalid", "The Railway host key is too long.", 400);
  const lines = value.trim().split(/\r?\n/);
  if (lines.length === 0 || lines.length > 5 || lines.some((line) => !/^ssh\.railway\.com (ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp256) [A-Za-z0-9+/]+={0,2}$/.test(line))) {
    throw new RailwayError("railway_ssh_host_key_invalid", "Paste verified known_hosts lines for ssh.railway.com only, without aliases, wildcards or comments.", 400);
  }
  return lines.join("\n") + "\n";
}

export async function generateRailwaySshKey(): Promise<{ publicKey: string; privateKey: string }> {
  const directory = await mkdtemp(path.join(tmpdir(), "paperclip-railway-key-"));
  try {
    const keyPath = path.join(directory, "identity");
    const sshKeygen = resolveRailwayOpenSshPath("ssh-keygen");
    if (!sshKeygen) throw new Error("OpenSSH unavailable");
    await promisify(execFile)(sshKeygen, ["-q", "-t", "ed25519", "-N", "", "-C", "paperclip-railway", "-f", railwayMsysPath(keyPath)], { timeout: 10_000, env: { PATH: process.platform === "win32" ? path.dirname(sshKeygen) : "/usr/bin:/bin" } });
    return { publicKey: (await readFile(`${keyPath}.pub`, "utf8")).trim(), privateKey: await readFile(keyPath, "utf8") };
  } catch {
    throw new RailwayError("railway_ssh_unavailable", "Generating a Railway key requires system OpenSSH (ssh-keygen) on the Paperclip runtime.", 422);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export function railwaySshArguments(directory: string, instanceId: string): string[] {
  if (!/^[a-f0-9-]{36}$/i.test(instanceId)) throw new RailwayError("railway_target_mismatch", "Invalid Railway container instance.", 400);
  return [
    "-F", "/dev/null", "-T", "-i", railwayMsysPath(path.join(directory, "identity")),
    "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "IdentityAgent=none",
    "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes", "-o", "ControlMaster=no",
    "-o", "ControlPath=none", "-o", "PermitLocalCommand=no", "-o", "StrictHostKeyChecking=yes",
    "-o", `UserKnownHostsFile=${railwayMsysPath(path.join(directory, "known_hosts"))}`, "-o", "GlobalKnownHostsFile=/dev/null",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=5", "-o", "ServerAliveCountMax=2",
    "--", `${instanceId}@ssh.railway.com`, "sh -s",
  ];
}

export async function runRailwaySshCommand(input: RailwaySshInput & { privateKey: string; knownHosts: string }) {
  input.signal.throwIfAborted();
  const knownHosts = validateRailwayKnownHosts(input.knownHosts);
  if (!input.privateKey.startsWith("-----BEGIN OPENSSH PRIVATE KEY-----")) throw new RailwayError("railway_ssh_key_invalid", "Regenerate the Railway connection's SSH key.", 422);
  const directory = await mkdtemp(path.join(tmpdir(), "paperclip-railway-command-"));
  try {
    await writeFile(path.join(directory, "identity"), input.privateKey, { mode: 0o600 });
    await writeFile(path.join(directory, "known_hosts"), knownHosts, { mode: 0o600 });
    input.signal.throwIfAborted();
    const ssh = resolveRailwayOpenSshPath("ssh");
    if (!ssh) throw new RailwayError("railway_ssh_unavailable", "System OpenSSH is unavailable on this Paperclip runtime.", 422);
    return await new Promise<{ exitCode: number | null; stdout: string; stderr: string; truncated: boolean; timedOut: boolean }>((resolve, reject) => {
      // No developer SSH config/agent, CLI login, provider token or ambient env.
      const child = spawn(ssh, railwaySshArguments(directory, input.deploymentInstanceId), { env: { PATH: process.platform === "win32" ? path.dirname(ssh) : "/usr/bin:/bin", LANG: "C.UTF-8" }, stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "", stderr = "", bytes = 0, truncated = false, timedOut = false, deliveryFailed = false;
      const marker = `paperclip_railway_completed_${randomBytes(16).toString("hex")}`;
      const stop = () => { child.kill("SIGKILL"); };
      const receive = (chunk: Buffer, stream: "out" | "err") => {
        const remaining = Math.max(0, 64 * 1024 - bytes);
        bytes += chunk.length;
        const text = chunk.subarray(0, remaining).toString("utf8");
        if (stream === "out") stdout += text; else stderr += text;
        if (bytes > 64 * 1024) { truncated = true; stop(); }
      };
      child.stdout.on("data", (chunk: Buffer) => receive(chunk, "out"));
      child.stderr.on("data", (chunk: Buffer) => receive(chunk, "err"));
      const timer = setTimeout(() => { timedOut = true; stop(); }, input.timeoutSeconds * 1000);
      const abort = () => stop();
      input.signal.addEventListener("abort", abort, { once: true });
      if (input.signal.aborted) abort();
      const cleanup = () => { clearTimeout(timer); input.signal.removeEventListener("abort", abort); };
      child.once("error", () => { cleanup(); reject(new RailwayError("railway_ssh_unavailable", "System OpenSSH is unavailable on this Paperclip runtime.", 422)); });
      child.once("close", (exitCode) => {
        cleanup();
        if (input.signal.aborted) { reject(input.signal.reason); return; }
        const completion = new RegExp(`\\n${marker}:(\\d+)\\r?\\n?$`).exec(stdout);
        if (!truncated && !timedOut && (deliveryFailed || !completion)) {
          reject(new RailwayError("railway_ssh_command_unconfirmed", "The container did not confirm command completion. Check SSH key registration, the trusted host key and deployment status before retrying."));
          return;
        }
        if (completion) stdout = stdout.slice(0, completion.index);
        resolve({ exitCode: completion ? Number(completion[1]) : exitCode, stdout: redactSensitiveText(stdout), stderr: redactSensitiveText(stderr), truncated, timedOut });
      });
      child.stdin.on("error", () => { deliveryFailed = true; });
      const quotedCommand = "'" + input.command.replace(/'/g, "'\\''") + "'";
      child.stdin.end(`sh -c ${quotedCommand} </dev/null\npaperclip_command_status=$?\nprintf '\\n${marker}:%d\\n' "$paperclip_command_status"\nexit "$paperclip_command_status"\n`);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
}
