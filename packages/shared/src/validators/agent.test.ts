import { describe, expect, it } from "vitest";
import { testAdapterEnvironmentSchema, updateAgentSchema } from "./agent.js";

describe("agent update schema", () => {
  it.each(["paused", "idle", "terminated"])("accepts lifecycle status request %s", status => {
    expect(updateAgentSchema.parse({ status })).toEqual({ status });
  });
  it.each(["active", "running", "error", "pending_approval"])("rejects direct status write %s", status => {
    const result = updateAgentSchema.safeParse({ name: "Renamed", status });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["status"] }),
    ]));
  });
  it.each([{ spentMonthlyCents: 0 }, { name: "Renamed", spentMonthlyCents: 10 }])("rejects spend totals: %j", payload => {
    const result = updateAgentSchema.safeParse(payload);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: ["spentMonthlyCents"] }),
    ]));
  });
  it("accepts profile and budget limit changes", () => {
    expect(updateAgentSchema.parse({ name: "Renamed", budgetMonthlyCents: 100 })).toEqual({ name: "Renamed", budgetMonthlyCents: 100 });
  });
});

describe("adapter environment test schema", () => {
  it("accepts a bounded external credential name for route-level adapter authorization", () => {
    expect(testAdapterEnvironmentSchema.safeParse({
      testCredentials: { FIXTURE_TOKEN: "probe-only" },
    }).success).toBe(true);
  });

  it.each([
    "prototype",
    "constructor",
    "invalid-key",
    "a".repeat(129),
  ])("rejects unsafe or malformed test credential key %s", (key) => {
    expect(testAdapterEnvironmentSchema.safeParse({
      testCredentials: { [key]: "probe-only" },
    }).success).toBe(false);
  });

  it("rejects a raw __proto__ own property before record normalization", () => {
    const testCredentials = JSON.parse('{"__proto__":"probe-only"}');
    expect(Object.prototype.hasOwnProperty.call(testCredentials, "__proto__")).toBe(true);
    expect(testAdapterEnvironmentSchema.safeParse({ testCredentials }).success).toBe(false);
  });

  it("bounds test credential entries and values", () => {
    expect(testAdapterEnvironmentSchema.safeParse({
      testCredentials: Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`KEY_${index}`, "probe-only"])),
    }).success).toBe(false);
    expect(testAdapterEnvironmentSchema.safeParse({
      testCredentials: { FIXTURE_TOKEN: "x".repeat(16_385) },
    }).success).toBe(false);
  });
});
