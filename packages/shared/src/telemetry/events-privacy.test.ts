import { afterEach, describe, expect, it, vi } from "vitest";
import { TelemetryClient } from "./client.js";
import {
  trackAgentCreated, trackAgentFirstHeartbeat, trackAgentTaskCompleted,
  trackAgentTaskRun, trackCompanyImported,
} from "./events.js";

function client(salt = "installation-a") {
  return new TelemetryClient(
    { enabled: true, endpoint: "https://telemetry.example.test/ingest" },
    () => ({ installId: "test-install", salt, createdAt: "2026-10-12T00:00:00Z", firstSeenVersion: "test" }),
    "test",
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("telemetry privacy at the wire boundary", () => {
  it("hashes agent IDs consistently within an installation and differently across installations", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const agentId = "private-agent-identifier";
    const first = client();
    trackAgentCreated(first, { agentId, agentRole: "engineer" });
    trackAgentFirstHeartbeat(first, { agentId, agentRole: "engineer" });
    trackAgentTaskCompleted(first, { agentId, agentRole: "engineer", adapterType: "process" });
    trackAgentTaskRun(first, { agentId, state: "succeeded" });
    await first.flush();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    const ids = body.events.map((event: { dimensions: { agent_id: string } }) => event.dimensions.agent_id);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(body)).not.toContain(agentId);
    const second = client("installation-b");
    trackAgentCreated(second, { agentId, agentRole: "engineer" });
    await second.flush();
    const other = JSON.parse(String(fetchMock.mock.calls[1][1].body));
    expect(other.events[0].dimensions.agent_id).not.toBe(ids[0]);
  });

  it.each([
    ["github", "https://github.com/private-org/private-repo"],
    ["github", "https://username:secret-token@github.com/private-org/private-repo"],
    ["url", "https://example.test/private-bundle?token=secret-token"],
    ["catalog", "https://username:secret-token@example.test/private-bundle"],
  ])("protects unverified or credential-bearing %s sources even when marked public", async (sourceType, sourceRef) => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const tc = client();
    const hash = vi.spyOn(tc, "hashPrivateRef");
    trackCompanyImported(tc, { sourceType, sourceRef, isPrivate: false });
    await tc.flush();
    const raw = String(fetchMock.mock.calls[0][1].body);
    const dims = JSON.parse(raw).events[0].dimensions;
    expect(dims.source_ref_hashed).toBe(true);
    expect(dims.source_ref).toMatch(/^[0-9a-f]{16}$/);
    expect(raw).not.toContain(sourceRef);
    expect(raw).not.toContain("private-repo");
    expect(raw).not.toContain("secret-token");
    if (sourceRef.includes("@")) expect(hash).toHaveBeenCalledWith(new URL(sourceRef.replace("username:secret-token@", "")).href);
  });

  it("preserves a verified public catalog identifier", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const tc = client();
    trackCompanyImported(tc, { sourceType: "catalog", sourceRef: "public-catalog/company", isPrivate: false });
    await tc.flush();
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.events[0].dimensions).toMatchObject({ source_ref: "public-catalog/company", source_ref_hashed: false });
  });
});
