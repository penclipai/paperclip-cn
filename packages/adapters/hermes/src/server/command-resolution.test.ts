import os from "node:os";
import path from "node:path";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { expect, test } from "vitest";

import { HERMES_CLI } from "../shared/constants.js";
import { execute, resolveHermesCommand } from "./execute.js";
import { testEnvironment } from "./test.js";

test("resolveHermesCommand prefers hermesCommand over command", () => {
  expect(resolveHermesCommand({ hermesCommand: "hermes_maximus", command: "hermes_backup" }))
    .toBe("hermes_maximus");
});

test("resolveHermesCommand falls back to command before default hermes binary", () => {
  expect(resolveHermesCommand({ command: "hermes_maximus" })).toBe("hermes_maximus");
  expect(resolveHermesCommand({})).toBe(HERMES_CLI);
});

test("testEnvironment accepts config.command when hermesCommand is absent", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hermes-command-resolution-"));
  const cliPath = path.join(
    tempDir,
    process.platform === "win32" ? "fake-hermes.cmd" : "fake-hermes",
  );

  try {
    await writeFile(
      cliPath,
      process.platform === "win32"
        ? "@echo off\r\necho fake-hermes 1.2.3\r\n"
        : "#!/bin/sh\necho fake-hermes 1.2.3\n",
      "utf8",
    );
    if (process.platform !== "win32") {
      await chmod(cliPath, 0o755);
    }

    const result = await testEnvironment({
      companyId: "company-test",
      adapterType: "hermes_local",
      config: {
        command: cliPath,
      },
    });

    expect(result.status).not.toBe("fail");
    expect(result.checks.some((check) => check.code === "hermes_cli_not_found")).toBe(false);
    expect(result.checks.some(
      (check) => check.code === "hermes_version" && check.message.includes("fake-hermes 1.2.3"),
    )).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("execute renders prompt API base from adapter env PAPERCLIP_API_URL", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hermes-prompt-api-url-"));
  const cliPath = path.join(tempDir, "fake-hermes");
  const argvPath = path.join(tempDir, "argv.txt");
  const originalApiUrl = process.env.PAPERCLIP_API_URL;

  try {
    process.env.PAPERCLIP_API_URL = "https://public.example.com/api";
    await writeFile(
      cliPath,
      [
        "#!/bin/sh",
        `printf '%s\\n' "$@" > ${JSON.stringify(argvPath)}`,
        "printf 'done\\n\\nsession_id: test-session\\n'",
        "",
      ].join("\n"),
      "utf8",
    );
    await chmod(cliPath, 0o755);

    await execute({
      runId: "run-test",
      agent: {
        id: "agent-test",
        name: "Hermes Test Agent",
        companyId: "company-test",
      },
      config: {
        hermesCommand: cliPath,
        env: {
          PAPERCLIP_API_URL: { type: "plain", value: "http://127.0.0.1:3101" },
        },
      },
      runtime: {},
      onLog: async () => {},
    } as any);

    const argv = await readFile(argvPath, "utf8");
    expect(argv).toContain("- API base: http://127.0.0.1:3101/api");
    expect(argv).not.toContain("https://public.example.com/api");
  } finally {
    if (originalApiUrl === undefined) {
      delete process.env.PAPERCLIP_API_URL;
    } else {
      process.env.PAPERCLIP_API_URL = originalApiUrl;
    }
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("managed connections probe the selected environment without falling back to host keys", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "hermes-managed-probe-"));
  const cliPath = path.join(tempDir, process.platform === "win32" ? "fake-hermes.cmd" : "fake-hermes");
  try {
    if (process.platform === "win32") {
      await writeFile(cliPath, `@echo off\r\nif not "%HERMES_HOME%"=="${tempDir}" exit /b 1\r\nif not "%OPENAI_API_KEY%"=="selected-key" exit /b 1\r\nif not "%ANTHROPIC_API_KEY%"=="" exit /b 1\r\nif not "%1"=="chat" exit /b 1\r\necho hello\r\n`);
    } else {
      await writeFile(cliPath, `#!${process.execPath}\nif (process.env.HERMES_HOME !== ${JSON.stringify(tempDir)}) process.exit(1);\nif (process.env.OPENAI_API_KEY !== "selected-key") process.exit(1);\nif (process.env.ANTHROPIC_API_KEY !== "") process.exit(1);\nif (process.argv[2] !== "chat") process.exit(1);\nconsole.log("hello");\n`);
    }
    if (process.platform !== "win32") {
      await chmod(cliPath, 0o755);
    }
    const config = { command: cliPath, managedAiRouting: true, model: "custom/model", provider: "auto", env: { HERMES_HOME: tempDir, OPENAI_API_KEY: "selected-key", ANTHROPIC_API_KEY: "" } };
    const passed = await testEnvironment({ companyId: "test", adapterType: "hermes_local", config });
    expect(passed.status).toBe("pass");
    expect(passed.checks[0]?.code).toBe("hermes_hello_probe_passed");
    const failed = await testEnvironment({ companyId: "test", adapterType: "hermes_local", config: { ...config, env: { ...config.env, OPENAI_API_KEY: "wrong-key" } } });
    expect(failed.status).toBe("fail");
    expect(failed.checks[0]?.code).toBe("hermes_hello_probe_failed");
    expect(JSON.stringify(failed)).not.toContain("wrong-key");
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
