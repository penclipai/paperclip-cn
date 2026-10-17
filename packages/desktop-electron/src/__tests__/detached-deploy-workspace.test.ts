import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createDetachedDeployWorkspace, resolveDeployWorkspaceClosure } from "../../scripts/detached-deploy-workspace.mjs";

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
    writeJson(source, "server/package.json", { name: "@penclipai/server", dependencies: { "@penclipai/a": "workspace:*" }, devDependencies: { "@penclipai/dev-only": "workspace:*" } });
    writeJson(source, "packages/a/package.json", { name: "@penclipai/a", optionalDependencies: { "@penclipai/b": "workspace:*" } });
    writeJson(source, "packages/b/package.json", { name: "@penclipai/b" });
    writeJson(source, "packages/dev-only/package.json", { name: "@penclipai/dev-only" });
    writeJson(source, "server/test-fixture/package.json", { name: "@penclipai/server" });
    fs.mkdirSync(path.join(source, "server", "node_modules", "should-not-copy"), { recursive: true });
    fs.writeFileSync(path.join(source, "server", "node_modules", "should-not-copy", "marker"), "source only");
    fs.mkdirSync(path.join(source, "packages", "a", ".claude"), { recursive: true });
    fs.writeFileSync(path.join(source, "packages", "a", ".claude", "secret"), "source only");
    fs.writeFileSync(path.join(source, "packages", "a", ".npmignore"), "src/\n");
    fs.writeFileSync(path.join(source, "server", "dist.js"), "built");

    expect(resolveDeployWorkspaceClosure(source, "@penclipai/server").map((pkg) => pkg.name)).toEqual([
      "@penclipai/a", "@penclipai/b", "@penclipai/dev-only", "@penclipai/server",
    ]);
    createDetachedDeployWorkspace({ repoRoot: source, workspaceRoot: detached });

    expect(fs.existsSync(path.join(detached, "server", "dist.js"))).toBe(true);
    expect(fs.existsSync(path.join(detached, "server", "node_modules"))).toBe(false);
    expect(fs.existsSync(path.join(detached, "packages", "a", ".claude"))).toBe(false);
    expect(fs.readFileSync(path.join(detached, "packages", "a", ".npmignore"), "utf8")).toBe("src/\n");
    expect(fs.readFileSync(path.join(source, "server", "package.json"), "utf8")).toContain("@penclipai/server");
    fs.writeFileSync(path.join(detached, "server", "package.json"), '{"name":"changed"}\n');
    expect(fs.readFileSync(path.join(source, "server", "package.json"), "utf8")).toContain("@penclipai/server");
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
