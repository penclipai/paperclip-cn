import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createDetachedDeployWorkspace, isQualifiedCopilotPlatform, resolveDeployWorkspaceClosure, resolveQualifiedCopilotMaterializerPackage } from "../../scripts/detached-deploy-workspace.mjs";

const roots: string[] = [];
function fixtureRoot() {
  const root = fs.mkdtempSync(path.join(process.env.PAPERCLIP_DESKTOP_TEST_TMP ?? os.tmpdir(), "paperclip-detached-deploy-"));
  roots.push(root);
  return root;
}
function writeJson(root: string, relative: string, value: unknown) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`);
}
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("detached desktop deploy workspace", () => {
  it("keeps root lifecycle scripts runnable inside the detached workspace", () => {
    const source = fixtureRoot();
    const detached = path.join(fixtureRoot(), "workspace");
    writeJson(source, "package.json", { name: "root", scripts: { postinstall: "node scripts/postinstall.mjs" } });
    writeJson(source, "server/package.json", { name: "@penclipai/server" });
    fs.mkdirSync(path.join(source, "scripts"));
    fs.writeFileSync(path.join(source, "scripts", "postinstall.mjs"), 'import fs from "node:fs"; fs.writeFileSync("postinstall-result", "detached");\n');
    createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached });
    execFileSync(process.execPath, [path.join(detached, "scripts", "postinstall.mjs")], { cwd: detached, stdio: "pipe" });
    expect(fs.readFileSync(path.join(detached, "postinstall-result"), "utf8")).toBe("detached");
    expect(fs.existsSync(path.join(source, "postinstall-result"))).toBe(false);
  });

  it("copies the required workspace closure without local dependencies or agent state", () => {
    const source = fixtureRoot();
    const detached = path.join(fixtureRoot(), "workspace");
    writeJson(source, "package.json", { name: "root", pnpm: { patchedDependencies: {} } });
    fs.writeFileSync(path.join(source, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    fs.writeFileSync(path.join(source, "pnpm-workspace.yaml"), "packages: ['packages/*', 'server']\n");
    writeJson(source, "server/package.json", { name: "@penclipai/server", dependencies: { "@penclipai/a": "workspace:*", "@penclipai/paperclip-runner": "workspace:*" }, devDependencies: { "@penclipai/dev-only": "workspace:*" } });
    writeJson(source, "packages/a/package.json", { name: "@penclipai/a", optionalDependencies: { "@penclipai/b": "workspace:*" } });
    writeJson(source, "packages/b/package.json", { name: "@penclipai/b" });
    writeJson(source, "packages/dev-only/package.json", { name: "@penclipai/dev-only" });
    writeJson(source, "packages/paperclip-runner/package.json", { name: "@penclipai/paperclip-runner" });
    writeJson(source, "server/test-fixture/package.json", { name: "@penclipai/server" });
    fs.mkdirSync(path.join(source, "server", "node_modules", "should-not-copy"), { recursive: true });
    fs.writeFileSync(path.join(source, "server", "node_modules", "should-not-copy", "marker"), "source only");
    fs.mkdirSync(path.join(source, "packages", "a", ".claude"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "a", ".claude", "secret"), "source only");
    fs.writeFileSync(path.join(source, "packages", "a", ".npmignore"), "src/\n");
    fs.writeFileSync(path.join(source, "server", "dist.js"), "built");
    const target = "linux-x64";
    const serverAssets = path.join(source, "server", "provider-assets", "copilot");
    fs.mkdirSync(path.join(serverAssets, target), { recursive: true });
    fs.writeFileSync(path.join(serverAssets, target, ".paperclip-copilot-closure.json"), "verified closure");
    fs.writeFileSync(path.join(serverAssets, target, ".secret"), "source only");
    fs.mkdirSync(path.join(serverAssets, "wrong-platform"), { recursive: true });
    fs.writeFileSync(path.join(serverAssets, "wrong-platform", ".paperclip-copilot-closure.json"), "source only");

    expect(resolveDeployWorkspaceClosure(source, "@penclipai/server").map((pkg) => pkg.name)).toEqual([
      "@penclipai/a", "@penclipai/b", "@penclipai/dev-only", "@penclipai/paperclip-runner", "@penclipai/server",
    ]);
    createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached });

    expect(fs.existsSync(path.join(detached, "server", "dist.js"))).toBe(true);
    expect(fs.existsSync(path.join(detached, "server", "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(detached, "packages", "a", ".claude"))).toBe(false);
    expect(fs.readFileSync(path.join(detached, "packages", "a", ".npmignore"), "utf8")).toBe("src/\n");
    expect(fs.readFileSync(path.join(detached, "server", "provider-assets", "copilot", target, ".paperclip-copilot-closure.json"), "utf8")).toBe("verified closure");
    expect(fs.existsSync(path.join(detached, "server", "provider-assets", "copilot", target, ".secret"))).toBe(false);
    expect(fs.existsSync(path.join(detached, "server", "provider-assets", "copilot", "wrong-platform", ".paperclip-copilot-closure.json"))).toBe(false);
    expect(fs.readFileSync(path.join(source, "server", "package.json"), "utf8")).toContain("@penclipai/server");
    fs.writeFileSync(path.join(detached, "server", "package.json"), '{"name":"changed"}\n');
    expect(fs.readFileSync(path.join(source, "server", "package.json"), "utf8")).toContain("@penclipai/server");
  });

  it("does not copy an allowlisted Copilot closure through a link", () => {
    const source = fixtureRoot();
    const detached = path.join(fixtureRoot(), "workspace");
    const target = "linux-x64";
    writeJson(source, "package.json", { name: "root" });
    writeJson(source, "server/package.json", { name: "@penclipai/server", dependencies: { "@penclipai/paperclip-runner": "workspace:*" } });
    writeJson(source, "packages/paperclip-runner/package.json", { name: "@penclipai/paperclip-runner" });
    const closure = path.join(source, "server", "provider-assets", "copilot", target, ".paperclip-copilot-closure.json");
    fs.mkdirSync(path.dirname(closure), { recursive: true });
    const sourceTarget = path.join(source, "closure-target");
    if (process.platform === "win32") {
      fs.mkdirSync(sourceTarget);
      fs.symlinkSync(sourceTarget, closure, "junction");
    } else {
      fs.writeFileSync(sourceTarget, "untrusted");
      fs.symlinkSync(sourceTarget, closure, "file");
    }

    createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached });

    expect(fs.existsSync(path.join(detached, "server", "provider-assets", "copilot", target, ".paperclip-copilot-closure.json"))).toBe(false);
  });

  it("admits only the Runner-qualified Copilot platform targets", () => {
    expect(resolveQualifiedCopilotMaterializerPackage("darwin", "arm64")).toBe("@github/copilot-darwin-arm64");
    expect(resolveQualifiedCopilotMaterializerPackage("darwin", "x64")).toBe("@github/copilot-darwin-x64");
    expect(resolveQualifiedCopilotMaterializerPackage("linux", "x64")).toBe("@github/copilot-linux-x64");
    expect(isQualifiedCopilotPlatform("darwin", "arm64")).toBe(true);
    expect(isQualifiedCopilotPlatform("darwin", "x64")).toBe(true);
    expect(isQualifiedCopilotPlatform("linux", "x64")).toBe(true);
    expect(isQualifiedCopilotPlatform("win32", "x64")).toBe(false);
    expect(isQualifiedCopilotPlatform("linux", "arm64")).toBe(false);
    expect(resolveQualifiedCopilotMaterializerPackage("win32", "x64")).toBeNull();
  });

  it("does not overwrite an existing destination", () => {
    const source = fixtureRoot();
    const detached = fixtureRoot();
    fs.writeFileSync(path.join(detached, "sentinel"), "keep");
    expect(() => createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached })).toThrow("must not already exist");
    expect(fs.readFileSync(path.join(detached, "sentinel"), "utf8")).toBe("keep");
  });

  it("refuses to create a workspace inside a source package", () => {
    const source = fixtureRoot();
    const detached = path.join(source, "server", "scratch");
    expect(() => createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached })).toThrow("must stay in desktop .stage");
    expect(fs.existsSync(detached)).toBe(false);
  });

  it("refuses a destination reached through a junction or symlink", () => {
    const source = fixtureRoot();
    const target = fixtureRoot();
    const link = path.join(fixtureRoot(), "linked");
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    expect(() => createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: path.join(link, "workspace") })).toThrow("Refusing linked");
    expect(fs.existsSync(path.join(target, "workspace"))).toBe(false);
  });
});
