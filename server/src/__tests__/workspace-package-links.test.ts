// @vitest-environment node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverWorkspacePackagePaths } from "../../../scripts/ensure-workspace-package-links.ts";

const fixtureRoots: string[] = [];

async function writePackage(directory: string, name: string, dependencies?: Record<string, string>) {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(directory, "package.json"),
    JSON.stringify({ name, ...(dependencies ? { dependencies } : {}) }),
    "utf8",
  );
}

async function writeWorkspaceManifest(root: string) {
  await fs.writeFile(path.join(root, "pnpm-workspace.yaml"), [
    "packages:",
    "  - packages/*",
    "  - packages/adapters/*",
    "  - packages/plugins/*",
    "  - '!packages/plugins/sandbox-providers/**'",
    "  - packages/plugins/sandbox-providers/*",
    "  - packages/plugins/examples/*",
    "  - '!packages/plugins/examples/plugin-orchestration-smoke-example'",
    "  - server",
    "  - ui",
    "  - cli",
    "unrelatedMetadata:",
    "  - packages/plugins/sandbox-providers/fixture",
    "",
  ].join("\n"), "utf8");
}

afterEach(async () => {
  await Promise.all(fixtureRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe("discoverWorkspacePackagePaths", () => {
  it("keeps canonical workspace packages ahead of nested staging and fixture copies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-workspace-links-"));
    fixtureRoots.push(root);
    const canonicalAdapterUtils = path.join(root, "packages", "adapter-utils");
    const stagedAdapterUtils = path.join(
      root,
      "packages",
      "desktop-electron",
      ".stage",
      "deploy-workspace",
      "packages",
      "adapter-utils",
    );
    const runtimeFixtureAdapterUtils = path.join(
      root,
      "packages",
      "desktop-electron",
      "app-runtime",
      "fixture",
    );
    const excludedSandboxProvider = path.join(root, "packages", "plugins", "sandbox-providers", "fixture");
    const excludedOrchestrationFixture = path.join(
      root,
      "packages",
      "plugins",
      "examples",
      "plugin-orchestration-smoke-example",
    );

    await writeWorkspaceManifest(root);
    await writePackage(canonicalAdapterUtils, "@fixture/adapter-utils");
    await writePackage(path.join(root, "server"), "@fixture/server", {
      "@fixture/adapter-utils": "workspace:*",
    });
    await writePackage(path.join(root, "packages", "desktop-electron"), "@fixture/desktop");
    await writePackage(stagedAdapterUtils, "@fixture/adapter-utils");
    await writePackage(runtimeFixtureAdapterUtils, "@fixture/adapter-utils");
    await writePackage(excludedSandboxProvider, "@fixture/adapter-utils");
    await writePackage(excludedOrchestrationFixture, "@fixture/orchestration-fixture", {
      "@fixture/adapter-utils": "workspace:*",
    });
    await writePackage(path.join(root, "ui"), "@fixture/ui");
    await writePackage(path.join(root, "cli"), "@fixture/cli");

    const discovered = discoverWorkspacePackagePaths(root);

    expect(discovered.get("@fixture/adapter-utils")).toBe(canonicalAdapterUtils);
    expect(discovered.get("@fixture/server")).toBe(path.join(root, "server"));
    expect(Array.from(discovered.values())).not.toContain(stagedAdapterUtils);
    expect(Array.from(discovered.values())).not.toContain(runtimeFixtureAdapterUtils);
    expect(Array.from(discovered.values())).not.toContain(excludedSandboxProvider);
    expect(discovered.has("@fixture/orchestration-fixture")).toBe(false);
  });
});
