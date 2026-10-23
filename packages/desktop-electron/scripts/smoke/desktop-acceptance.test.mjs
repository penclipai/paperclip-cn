import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildLaunchEnv } from "./desktop-acceptance.mjs";
import { buildLaunchEnv as buildDesktopElectronLaunchEnv } from "./desktop-electron.mjs";

test("desktop smoke launch environments strip host authentication secrets", () => {
  const userDataDir = path.resolve("D:\\CodexDesktop\\smoke-profile");
  const hostEnv = {
    PAPERCLIP_AGENT_JWT_SECRET: "host-jwt-secret",
    BETTER_AUTH_SECRET: "host-better-auth-secret",
    PAPERCLIP_CONFIG: "C:\\host\\config.json",
    PAPERCLIP_CONTEXT: "C:\\host\\context.json",
    paperclip_agent_jwt_secret: "host-lowercase-jwt-secret",
    Better_Auth_Secret: "host-mixedcase-better-auth-secret",
    paperclip_config: "C:\\host\\lowercase-config.json",
    UNRELATED_SETTING: "retained",
  };

  for (const makeEnvironment of [buildLaunchEnv, buildDesktopElectronLaunchEnv]) {
    const env = makeEnvironment(userDataDir, hostEnv);
    assert.equal(env.PAPERCLIP_AGENT_JWT_SECRET, undefined);
    assert.equal(env.BETTER_AUTH_SECRET, undefined);
    assert.equal(env.paperclip_agent_jwt_secret, undefined);
    assert.equal(env.Better_Auth_Secret, undefined);
    assert.equal(env.paperclip_config, undefined);
    assert.equal(env.UNRELATED_SETTING, "retained");
    assert.equal(env.PAPERCLIP_HOME, path.resolve(userDataDir, "runtime"));
    assert.equal(env.PAPERCLIP_CONFIG, path.resolve(userDataDir, "runtime", "config.json"));
  }
});

test("desktop acceptance pure launch environment import needs no Playwright dependency", () => {
  const parent = fs.realpathSync(os.tmpdir());
  const prefix = "desktop-acceptance-import-";
  const root = fs.realpathSync(fs.mkdtempSync(path.join(parent, prefix)));
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const copy = (relativePath) => {
    const destination = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(path.join(repoRoot, relativePath), destination);
  };

  try {
    copy("packages/desktop-electron/scripts/smoke/desktop-acceptance.mjs");
    copy("packages/desktop-electron/scripts/smoke/desktop-electron.mjs");
    copy("packages/desktop-electron/scripts/utils.mjs");
    copy("scripts/pnpm-invocation.mjs");
    const fixture = path.join(root, "import-pure.mjs");
    fs.writeFileSync(fixture, [
      'import { buildLaunchEnv } from "./packages/desktop-electron/scripts/smoke/desktop-acceptance.mjs";',
      'import { buildLaunchEnv as buildDesktopElectronLaunchEnv } from "./packages/desktop-electron/scripts/smoke/desktop-electron.mjs";',
      'const env = buildLaunchEnv("/fresh-profile", { UNRELATED: "retained" });',
      'if (env.UNRELATED !== "retained") throw new Error("pure helper did not run");',
      'const desktopElectronEnv = buildDesktopElectronLaunchEnv("/fresh-profile", { UNRELATED: "retained" });',
      'if (desktopElectronEnv.UNRELATED !== "retained") throw new Error("desktop electron pure helper did not run");',
    ].join("\n"));
    const result = spawnSync(process.execPath, [fixture], {
      cwd: root,
      env: { ...process.env, NODE_PATH: "" },
      encoding: "utf8",
      shell: false,
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    if (
      path.dirname(root) !== parent ||
      !path.basename(root).startsWith(prefix) ||
      fs.lstatSync(root).isSymbolicLink() ||
      fs.realpathSync(root) !== root
    ) {
      throw new Error(`Refusing to remove unexpected dependency-free import fixture root: ${root}`);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
