import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { testEnvironment } from "@penclipai/adapter-qwen-local/server";

async function writeFakeQwenCommand(binDir: string, scriptBody: string): Promise<string> {
  if (process.platform === "win32") {
    const scriptPath = path.join(binDir, "qwen.js");
    const commandPath = path.join(binDir, "qwen.cmd");
    await fs.writeFile(scriptPath, scriptBody, "utf8");
    await fs.writeFile(commandPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return commandPath;
  }

  const commandPath = path.join(binDir, "qwen");
  await fs.writeFile(commandPath, `#!/usr/bin/env node\n${scriptBody}`, "utf8");
  await fs.chmod(commandPath, 0o755);
  return commandPath;
}

describe("qwen environment diagnostics", () => {
  it("creates a missing working directory and adds --approval-mode yolo by default", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-qwen-local-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    const argsCapturePath = path.join(root, "args.json");
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeQwenCommand(
      binDir,
      `
const fs = require("node:fs");
const outPath = process.env.PAPERCLIP_TEST_ARGS_PATH;
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(process.argv.slice(2)), "utf8");
}
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "output_text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  result: "hello",
}));
`,
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        command: "qwen",
        cwd,
        env: {
          PAPERCLIP_TEST_ARGS_PATH: argsCapturePath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    });

    expect(result.status).toBe("pass");
    expect((await fs.stat(cwd)).isDirectory()).toBe(true);
    const args = JSON.parse(await fs.readFile(argsCapturePath, "utf8")) as string[];
    expect(args).toEqual(
      expect.arrayContaining(["--output-format", "stream-json", "--approval-mode", "yolo"]),
    );
    await fs.rm(root, { recursive: true, force: true });
  }, 15_000);

  it("does not duplicate approval mode when extraArgs already set it", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-qwen-local-probe-extra-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    const argsCapturePath = path.join(root, "args.json");
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeQwenCommand(
      binDir,
      `
const fs = require("node:fs");
const outPath = process.env.PAPERCLIP_TEST_ARGS_PATH;
if (outPath) {
  fs.writeFileSync(outPath, JSON.stringify(process.argv.slice(2)), "utf8");
}
console.log(JSON.stringify({
  type: "assistant",
  message: { content: [{ type: "output_text", text: "hello" }] },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  result: "hello",
}));
`,
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        command: "qwen",
        cwd,
        extraArgs: ["--approval-mode", "yolo"],
        env: {
          PAPERCLIP_TEST_ARGS_PATH: argsCapturePath,
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    });

    expect(result.status).toBe("pass");
    const args = JSON.parse(await fs.readFile(argsCapturePath, "utf8")) as string[];
    expect(args.filter((arg) => arg === "--approval-mode")).toHaveLength(1);
    expect(args.filter((arg) => arg === "yolo")).toHaveLength(1);
    await fs.rm(root, { recursive: true, force: true });
  }, 15_000);

  it("returns a warning when Qwen authentication is not ready", async () => {
    const root = path.join(
      os.tmpdir(),
      `paperclip-qwen-local-auth-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
    const binDir = path.join(root, "bin");
    const cwd = path.join(root, "workspace");
    await fs.mkdir(binDir, { recursive: true });
    await writeFakeQwenCommand(
      binDir,
      `
console.log(JSON.stringify({
  type: "assistant",
  message: {
    content: [
      { type: "output_text", text: "[API Error: 401 invalid access token or token expired]" },
    ],
  },
}));
console.log(JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  result: "[API Error: 401 invalid access token or token expired]",
}));
`,
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "qwen_local",
      config: {
        command: "qwen",
        cwd,
        env: {
          PATH: `${binDir}${path.delimiter}${process.env.PATH ?? ""}`,
        },
      },
    });

    expect(result.status).toBe("warn");
    expect(result.checks.some((check) => check.code === "qwen_hello_probe_auth_required")).toBe(true);
    await fs.rm(root, { recursive: true, force: true });
  }, 15_000);
});
