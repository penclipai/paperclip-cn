import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { buildLaunchEnv } from "./desktop-acceptance.mjs";

test("desktop acceptance launch environment strips host authentication secrets", () => {
  const userDataDir = path.resolve("D:\\CodexDesktop\\smoke-profile");
  const env = buildLaunchEnv(userDataDir, {
    PAPERCLIP_AGENT_JWT_SECRET: "host-jwt-secret",
    BETTER_AUTH_SECRET: "host-better-auth-secret",
    PAPERCLIP_CONFIG: "C:\\host\\config.json",
    PAPERCLIP_CONTEXT: "C:\\host\\context.json",
    paperclip_agent_jwt_secret: "host-lowercase-jwt-secret",
    Better_Auth_Secret: "host-mixedcase-better-auth-secret",
    paperclip_config: "C:\\host\\lowercase-config.json",
    UNRELATED_SETTING: "retained",
  });

  assert.equal(env.PAPERCLIP_AGENT_JWT_SECRET, undefined);
  assert.equal(env.BETTER_AUTH_SECRET, undefined);
  assert.equal(env.paperclip_agent_jwt_secret, undefined);
  assert.equal(env.Better_Auth_Secret, undefined);
  assert.equal(env.paperclip_config, undefined);
  assert.equal(env.UNRELATED_SETTING, "retained");
  assert.equal(env.PAPERCLIP_HOME, path.resolve(userDataDir, "runtime"));
  assert.equal(env.PAPERCLIP_CONFIG, path.resolve(userDataDir, "runtime", "config.json"));
});
