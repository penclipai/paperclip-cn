import type { UiLocale } from "@penclipai/shared";
import { resolveEffectiveRuntimeUiLocaleForContextSnapshot } from "./agent-runtime-localization.js";

export function materializeRuntimeUiLocaleContextSnapshot(
  contextSnapshot: Record<string, unknown>,
  runtimeDefaultLocale: UiLocale,
) {
  const nextContextSnapshot: Record<string, unknown> = {
    ...contextSnapshot,
    runtimeUiLocale: resolveEffectiveRuntimeUiLocaleForContextSnapshot(
      contextSnapshot,
      runtimeDefaultLocale,
    ),
  };
  delete nextContextSnapshot.requestedUiLocale;
  return nextContextSnapshot;
}

export function resolveContextRuntimeUiLocale(
  contextSnapshot: Record<string, unknown> | null | undefined,
  runtimeDefaultLocale: UiLocale,
) {
  return resolveEffectiveRuntimeUiLocaleForContextSnapshot(
    contextSnapshot,
    runtimeDefaultLocale,
  );
}

export function canCoalesceWithRunLocale(input: {
  existingContextSnapshot: Record<string, unknown> | null | undefined;
  incomingContextSnapshot: Record<string, unknown>;
  existingStatus: string | null | undefined;
  runtimeDefaultLocale: UiLocale;
}) {
  if (input.existingStatus !== "running") return true;
  return (
    resolveContextRuntimeUiLocale(
      input.existingContextSnapshot,
      input.runtimeDefaultLocale,
    ) ===
    resolveContextRuntimeUiLocale(
      input.incomingContextSnapshot,
      input.runtimeDefaultLocale,
    )
  );
}
