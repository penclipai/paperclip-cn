import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { parse as parseDotenv } from "dotenv";
import { updateEnvFileContents, writeEnvFileAtomicallyIfChanged } from "@penclipai/shared/env-file";
import { resolvePaperclipEnvPath } from "./paths.js";

const DESKTOP_MODES = new Set(["packaged", "development"]);

function configuredSecret(value: string | undefined): string | null {
  const secret = value?.trim();
  return secret || null;
}

function readExistingEnvFile(envPath: string): string | null {
  try {
    return readFileSync(envPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Makes the local-agent JWT signing key durable for ordinary desktop startup.
 *
 * The config module has already loaded dotenv by the time the server starts,
 * so a newly written value must also be assigned to this process explicitly.
 */
export function ensureDesktopAgentJwtSecret(): string | null {
  if (!DESKTOP_MODES.has(process.env.PAPERCLIP_DESKTOP_MODE ?? "")) return null;

  const existingProcessSecret = configuredSecret(process.env.PAPERCLIP_AGENT_JWT_SECRET)
    ?? configuredSecret(process.env.BETTER_AUTH_SECRET);
  if (existingProcessSecret) {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = existingProcessSecret;
    return existingProcessSecret;
  }

  const envPath = resolvePaperclipEnvPath();
  const previousContents = readExistingEnvFile(envPath);
  const persistedValues = parseDotenv(previousContents ?? "");
  const existingPersistedSecret = configuredSecret(persistedValues.PAPERCLIP_AGENT_JWT_SECRET)
    ?? configuredSecret(persistedValues.BETTER_AUTH_SECRET);
  if (existingPersistedSecret) {
    process.env.PAPERCLIP_AGENT_JWT_SECRET = existingPersistedSecret;
    return existingPersistedSecret;
  }

  const generatedSecret = randomBytes(32).toString("hex");
  const nextContents = updateEnvFileContents(
    previousContents ?? "",
    { PAPERCLIP_AGENT_JWT_SECRET: generatedSecret },
  );
  writeEnvFileAtomicallyIfChanged(envPath, previousContents, nextContents);
  process.env.PAPERCLIP_AGENT_JWT_SECRET = generatedSecret;
  return generatedSecret;
}
