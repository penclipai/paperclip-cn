import { describe, expect, it, vi } from "vitest";

const playwright = vi.hoisted(() => ({ attach: vi.fn(async () => undefined) }));

vi.mock("@playwright/test", () => ({
  expect: (actual: unknown, message?: string) => ({
    toBe: (expected: unknown) => expect(actual, message).toBe(expected),
  }),
  test: { info: () => ({ attach: playwright.attach }) },
}));

import { setup } from "../../../tests/e2e/agent-chat.shared.ts";

type RequestOptions = { data?: unknown };
type Response = {
  ok(): boolean;
  status(): number;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

const originalSettings = {
  enableAgentChat: false,
  enableClassicTaskInterface: true,
};

function response(body: unknown, ok = true): Response {
  return {
    ok: () => ok,
    status: () => ok ? 200 : 500,
    json: async () => body,
    text: async () => typeof body === "string" ? body : JSON.stringify(body),
  };
}

function createRequest({ cancelSucceeds }: { cancelSucceeds: boolean }) {
  const experimentalPatches: unknown[] = [];
  let agentCount = 0;
  const request = {
    get: vi.fn(async (url: string): Promise<Response> => {
      if (url === "/api/instance/settings/experimental") return response(originalSettings);
      if (url === "/api/companies/company/chats/agent-1") return response(null, false);
      if (url === "/api/companies/company/issues") return response([]);
      if (url === "/api/companies/company/projects") return response([]);
      if (url === "/api/companies/company/heartbeat-runs") return response([]);
      if (url === "/api/companies/company/live-runs") return response([{ id: "run-1" }]);
      throw new Error(`Unexpected GET ${url}`);
    }),
    post: vi.fn(async (url: string): Promise<Response> => {
      if (url === "/api/companies") return response({ id: "company", issuePrefix: "CHAT" });
      if (url === "/api/companies/company/agents") return response({ id: `agent-${++agentCount}` });
      if (url === "/api/heartbeat-runs/run-1/cancel") {
        return cancelSucceeds ? response({}) : response({ error: "deadlock" }, false);
      }
      throw new Error(`Unexpected POST ${url}`);
    }),
    patch: vi.fn(async (url: string, options?: RequestOptions): Promise<Response> => {
      if (url !== "/api/instance/settings/experimental") throw new Error(`Unexpected PATCH ${url}`);
      experimentalPatches.push(options?.data);
      return response({});
    }),
  };
  return { request, experimentalPatches };
}

describe("agent chat E2E fixture cleanup", () => {
  it("restores experimental settings when live-run cancellation fails", async () => {
    const { request, experimentalPatches } = createRequest({ cancelSucceeds: false });
    const fixture = await setup(request as never);

    await expect(fixture.restore()).rejects.toThrow("deadlock");

    expect(experimentalPatches).toEqual([
      { enableAgentChat: true, enableClassicTaskInterface: false },
      originalSettings,
    ]);
  });

  it("cancels live runs and restores the original experimental settings", async () => {
    const { request, experimentalPatches } = createRequest({ cancelSucceeds: true });
    const fixture = await setup(request as never);

    await expect(fixture.restore()).resolves.toBeUndefined();

    expect(request.post).toHaveBeenCalledWith("/api/heartbeat-runs/run-1/cancel");
    expect(experimentalPatches).toEqual([
      { enableAgentChat: true, enableClassicTaskInterface: false },
      originalSettings,
    ]);
  });
});
