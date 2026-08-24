import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function commandInvocation(command: string, args: string[]) {
  if (process.platform !== "win32") return { command, args };
  const quoteArg = (value: string) =>
    /^[A-Za-z0-9_/:=.,@+\\-]+$/.test(value) ? value : `"${value.replace(/"/g, "\"\"")}"`;
  const escaped = [command, ...args].map(quoteArg).join(" ");
  return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/c", escaped] };
}

function execTool(command: string, args: string[], options: Parameters<typeof execFileSync>[2]) {
  const invocation = commandInvocation(command, args);
  return execFileSync(invocation.command, invocation.args, options);
}

function readPackMetadata(packDestination: string) {
  const output = execTool("npm", ["pack", "--json", "--pack-destination", packDestination], {
    cwd: packageRoot,
    encoding: "utf8",
  }) as string;
  const parsed = JSON.parse(output) as unknown;
  const candidates = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  const metadata = candidates[0] as { filename?: unknown; files?: unknown } | undefined;
  if (typeof metadata?.filename !== "string" || !Array.isArray(metadata.files)) {
    throw new Error(`Unexpected npm pack output from ${packageRoot}: ${output}`);
  }
  return metadata as { filename: string; files: Array<{ path: string }> };
}

describe("skills catalog package artifacts", () => {
  const cleanup: string[] = [];

  function createPackDestination() {
    const destination = mkdtempSync(path.join(tmpdir(), "paperclip-skills-catalog-pack-"));
    cleanup.push(destination);
    return destination;
  }

  afterEach(async () => {
    await Promise.all(cleanup.map((entry) => rm(entry, { force: true, recursive: true })));
    cleanup.length = 0;
  });

  it("packs dist manifest and catalog files for npm artifact consumers", () => {
    let metadata = readPackMetadata(createPackDestination());

    if (!metadata.files.some((entry) => entry.path === "dist/generated/catalog.json")) {
      execTool("pnpm", ["--filter", "@penclipai/skills-catalog", "build"], {
        cwd: packageRoot,
        stdio: "ignore",
      });
      metadata = readPackMetadata(createPackDestination());
    }

    const paths = metadata.files.map((entry) => entry.path);

    expect(paths).toContain("dist/generated/catalog.json");
    expect(paths).toContain("generated/catalog.json");
    expect(paths).toContain("catalog/bundled/software-development/github-pr-workflow/SKILL.md");
    expect(paths).toContain("catalog/optional/browser/agent-browser/SKILL.md");
    expect(paths).toContain("package.json");
  }, 120_000);
});
