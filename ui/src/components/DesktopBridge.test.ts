import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "@/lib/queryKeys";
import { __desktopBridgeTestUtils } from "./DesktopBridge";

describe("DesktopBridge cache boundary", () => {
  it("counts only fresh running rows across live-run cache variants", () => {
    const client = new QueryClient();
    const now = Date.now();
    client.setQueryData(queryKeys.liveRuns("company-1"), [
      { id: "running", status: "running" },
      { id: "queued", status: "queued" },
    ], { updatedAt: now });
    client.setQueryData(["live-runs", "company-1", "compact"], [
      { id: "running", status: "running" },
      { id: "other", status: "running" },
    ], { updatedAt: now });
    expect(__desktopBridgeTestUtils.activeRunCount(client, "company-1")).toBe(2);
  });

  it("returns unknown for a stale cache and clears unauthorized company context", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.liveRuns("company-1"), [{ id: "running", status: "running" }], {
      updatedAt: Date.now() - 60_001,
    });
    expect(__desktopBridgeTestUtils.activeRunCount(client, "company-1")).toBeNull();
    expect(__desktopBridgeTestUtils.canSendDesktopCompanyContext("success", false, undefined)).toBe(false);
    expect(__desktopBridgeTestUtils.canSendDesktopCompanyContext("success", false, "local_trusted")).toBe(true);
  });

  it("treats cached running rows as a lower bound and an empty cache as unknown", () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.liveRuns("company-1"), Array.from({ length: 50 }, (_, index) => ({
      id: `run-${index}`,
      status: index < 3 ? "running" : "succeeded",
    })));
    expect(__desktopBridgeTestUtils.activeRunCount(client, "company-1")).toBe(3);
    client.setQueryData(queryKeys.liveRuns("company-1"), []);
    expect(__desktopBridgeTestUtils.activeRunCount(client, "company-1")).toBeNull();
  });

  it("accepts only safe app-internal navigation paths", () => {
    expect(__desktopBridgeTestUtils.isSafeDesktopPath("/agents/a/runs/b")).toBe(true);
    expect(__desktopBridgeTestUtils.isSafeDesktopPath("//example.com")).toBe(false);
    expect(__desktopBridgeTestUtils.isSafeDesktopPath("/auth/login")).toBe(false);
    expect(__desktopBridgeTestUtils.isSafeDesktopPath("/agents/%2fsecret")).toBe(false);
  });
});
