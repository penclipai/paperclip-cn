import { models as anthropic } from "@penclipai/adapter-claude-local";
import { models as openai } from "@penclipai/adapter-codex-local";
import { models as google } from "@penclipai/adapter-gemini-local";
import { models as xai } from "@penclipai/adapter-grok-local";
import type { AiConnectionMetadata } from "@penclipai/shared";

/** Catalogs follow the saved API connection, never the host CLI's credentials or environment. */
export function fastResponseCatalogModels(connection: Pick<AiConnectionMetadata, "provider" | "routing">) {
  if (connection.routing) return connection.routing.models ?? [];
  return { anthropic, openai, google, xai, openrouter: [] }[connection.provider];
}
