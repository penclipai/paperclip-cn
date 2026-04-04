import { describe, expect, it } from "vitest";
import {
  canCoalesceWithRunLocale,
  materializeRuntimeUiLocaleContextSnapshot,
} from "../services/heartbeat-runtime-locale.js";

describe("heartbeat runtime locale materialization", () => {
  it("materializes the instance default locale and strips request-scoped locale fields", () => {
    expect(
      materializeRuntimeUiLocaleContextSnapshot(
        {
          taskKey: "fresh-task",
          requestedUiLocale: "en",
        },
        "zh-CN",
      ),
    ).toEqual({
      taskKey: "fresh-task",
      runtimeUiLocale: "en",
    });
  });

  it("recomputes queued run locale from the latest wake context", () => {
    const existing = {
      taskKey: "same-task",
      runtimeUiLocale: "zh-CN",
    };
    const incoming = materializeRuntimeUiLocaleContextSnapshot(
      {
        taskKey: "same-task",
      },
      "en",
    );

    expect({
      ...existing,
      ...incoming,
    }).toEqual({
      taskKey: "same-task",
      runtimeUiLocale: "en",
    });
  });

  it("does not coalesce a running run when the new wake resolves to a different runtime locale", () => {
    expect(
      canCoalesceWithRunLocale({
        existingContextSnapshot: {
          taskKey: "same-task",
          runtimeUiLocale: "zh-CN",
        },
        incomingContextSnapshot: {
          taskKey: "same-task",
          runtimeUiLocale: "en",
        },
        existingStatus: "running",
        runtimeDefaultLocale: "zh-CN",
      }),
    ).toBe(false);
  });

  it("still coalesces running runs when the resolved runtime locale matches", () => {
    expect(
      canCoalesceWithRunLocale({
        existingContextSnapshot: {
          taskKey: "same-task",
          runtimeUiLocale: "zh-CN",
        },
        incomingContextSnapshot: {
          taskKey: "same-task",
          requestedUiLocale: "zh-CN",
        },
        existingStatus: "running",
        runtimeDefaultLocale: "en",
      }),
    ).toBe(true);
  });
});
