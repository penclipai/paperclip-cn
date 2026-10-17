import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const helper = fileURLToPath(new URL("../../../skills/paperclip/scripts/paperclip-artifact-json.mjs", import.meta.url));
const run = (operation: string, args: string[] = [], input?: string) =>
  spawnSync(process.execPath, [helper, operation, ...args], { encoding: "utf8", input, timeout: 10_000 });

describe("artifact JSON fallback boundaries", () => {
  it("preserves quotes, newlines, Unicode, and boolean types in dry-run output", () => {
    const title = '中文 "quoted"\nsecond line';
    const result = run("dry-run", ["file with spaces.json", "issue", "company", title, "", "application/json", "ready_for_review", "", "true", "false"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ title, summary: "", chatComment: null, createWorkProduct: true, isPrimary: false });
  });

  it("recognizes only a structured indeterminate response", () => {
    expect(run("response-is-indeterminate", [], '{"outcome":"indeterminate"}').status).toBe(0);
    expect(run("response-is-indeterminate", [], '{"outcome":"committed"}').status).toBe(1);
    const invalid = run("response-is-indeterminate", [], "invalid private response");
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Expected valid JSON input");
    expect(invalid.stderr).not.toContain("private response");
  });

  it("leaves a null work product identifier empty", () => {
    const result = run("attachment-value", ["id"], "null");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("retains API paths and numeric byte sizes in work products", () => {
    const result = run("work-product", ["title", "", "ready_for_review", "run", "attachment", "text/plain", "42", "/api/content", "/api/open", "/api/download?download=1", "proof.txt", "true"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ isPrimary: true, summary: null, metadata: { byteSize: 42, contentPath: "/api/content", openPath: "/api/open", downloadPath: "/api/download?download=1" } });
  });
});
