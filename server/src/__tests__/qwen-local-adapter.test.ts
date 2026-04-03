import { describe, expect, it, vi } from "vitest";
import {
  isQwenUnknownSessionError,
  parseQwenJsonl,
} from "@penclipai/adapter-qwen-local/server";
import { parseQwenStdoutLine } from "@penclipai/adapter-qwen-local/ui";
import { printQwenStreamEvent } from "@penclipai/adapter-qwen-local/cli";

describe("qwen parser", () => {
  it("extracts session, summary, usage, cost, and auth-style assistant failures", () => {
    const stdout = [
      JSON.stringify({
        type: "system",
        subtype: "init",
        session_id: "qwen-session-1",
        model: "coder-model",
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          content: [
            { type: "output_text", text: "Checking credentials." },
            {
              type: "output_text",
              text: "[API Error: 401 invalid access token or token expired]",
            },
          ],
        },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        session_id: "qwen-session-1",
        usage: {
          input_tokens: 18,
          cached_input_tokens: 4,
          output_tokens: 7,
        },
        total_cost_usd: 0.00042,
        result: "[API Error: 401 invalid access token or token expired]",
      }),
    ].join("\n");

    const parsed = parseQwenJsonl(stdout);
    expect(parsed.sessionId).toBe("qwen-session-1");
    expect(parsed.summary).toContain("Checking credentials.");
    expect(parsed.usage).toEqual({
      inputTokens: 18,
      cachedInputTokens: 4,
      outputTokens: 7,
    });
    expect(parsed.costUsd).toBeCloseTo(0.00042, 6);
    expect(parsed.errorMessage).toBe("[API Error: 401 invalid access token or token expired]");
  });

  it("parses multiplexed stdout-prefixed json lines", () => {
    const stdout = [
      'stdout{"type":"system","subtype":"init","session_id":"qwen-prefixed","model":"coder-model"}',
      'stdout{"type":"assistant","message":{"content":[{"type":"output_text","text":"prefixed hello"}]}}',
      'stdout{"type":"result","subtype":"success","usage":{"input_tokens":3,"output_tokens":2,"cached_input_tokens":1},"total_cost_usd":0.0001}',
    ].join("\n");

    const parsed = parseQwenJsonl(stdout);
    expect(parsed.sessionId).toBe("qwen-prefixed");
    expect(parsed.summary).toBe("prefixed hello");
    expect(parsed.usage).toEqual({
      inputTokens: 3,
      cachedInputTokens: 1,
      outputTokens: 2,
    });
    expect(parsed.costUsd).toBeCloseTo(0.0001, 6);
  });
});

describe("qwen stale session detection", () => {
  it("treats missing/unknown session messages as an unknown session error", () => {
    expect(
      isQwenUnknownSessionError(
        "",
        "No saved session found with ID 33535c53-83c2-475e-821f-66098883f75b",
      ),
    ).toBe(true);
    expect(
      isQwenUnknownSessionError(
        "",
        "failed to resume previous session",
      ),
    ).toBe(true);
  });
});

describe("qwen ui stdout parser", () => {
  it("parses assistant, thinking, and embedded tool lifecycle events", () => {
    const ts = "2026-04-02T00:00:00.000Z";

    expect(
      parseQwenStdoutLine(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [
              { type: "output_text", text: "I will inspect the repo." },
              { type: "thinking", text: "Checking AGENTS.md first" },
              {
                type: "tool_call",
                name: "run_shell_command",
                input: { command: "dir" },
                tool_use_id: "tool_1",
              },
              {
                type: "tool_result",
                tool_use_id: "tool_1",
                output: "AGENTS.md\r\n",
                status: "ok",
              },
            ],
          },
        }),
        ts,
      ),
    ).toEqual([
      { kind: "assistant", ts, text: "I will inspect the repo." },
      { kind: "thinking", ts, text: "Checking AGENTS.md first" },
      {
        kind: "tool_call",
        ts,
        name: "run_shell_command",
        toolUseId: "tool_1",
        input: { command: "dir" },
      },
      {
        kind: "tool_result",
        ts,
        toolUseId: "tool_1",
        content: "AGENTS.md\r\n",
        isError: false,
      },
    ]);
  });

  it("parses top-level tool lifecycle and result usage", () => {
    const ts = "2026-04-02T00:00:00.000Z";

    expect(
      parseQwenStdoutLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "call_shell_1",
          tool_call: {
            run_shell_command: {
              command: "curl -s https://example.com",
            },
          },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "tool_call",
        ts,
        name: "run_shell_command",
        toolUseId: "call_shell_1",
        input: { command: "curl -s https://example.com" },
      },
    ]);

    expect(
      parseQwenStdoutLine(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "call_shell_1",
          tool_call: {
            run_shell_command: {
              result: {
                success: {
                  exitCode: 0,
                  stdout: "ok",
                  stderr: "",
                },
              },
            },
          },
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "tool_result",
        ts,
        toolUseId: "call_shell_1",
        content: "exit 0\n<stdout>\nok",
        isError: false,
      },
    ]);

    expect(
      parseQwenStdoutLine(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "Done",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            cached_input_tokens: 2,
          },
          total_cost_usd: 0.00042,
          is_error: false,
        }),
        ts,
      ),
    ).toEqual([
      {
        kind: "result",
        ts,
        text: "Done",
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        costUsd: 0.00042,
        subtype: "success",
        isError: false,
        errors: [],
      },
    ]);
  });
});

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;]*m/g, "");
}

describe("qwen cli formatter", () => {
  it("prints init, assistant, thinking, tool, and result events", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    let output = "";

    try {
      printQwenStreamEvent(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "qwen-session-1",
          model: "coder-model",
        }),
        false,
      );
      printQwenStreamEvent(
        JSON.stringify({
          type: "assistant",
          message: {
            content: [{ type: "output_text", text: "hello" }],
          },
        }),
        false,
      );
      printQwenStreamEvent(
        JSON.stringify({
          type: "thinking",
          subtype: "delta",
          text: "looking at package.json",
        }),
        false,
      );
      printQwenStreamEvent(
        JSON.stringify({
          type: "tool_call",
          subtype: "started",
          call_id: "call_1",
          tool_call: {
            run_shell_command: {
              command: "dir",
            },
          },
        }),
        false,
      );
      printQwenStreamEvent(
        JSON.stringify({
          type: "tool_call",
          subtype: "completed",
          call_id: "call_1",
          tool_call: {
            run_shell_command: {
              result: {
                success: {
                  exitCode: 0,
                  stdout: "AGENTS.md",
                  stderr: "",
                },
              },
            },
          },
        }),
        false,
      );
      printQwenStreamEvent(
        JSON.stringify({
          type: "result",
          subtype: "success",
          result: "done",
          usage: {
            input_tokens: 11,
            output_tokens: 6,
            cached_input_tokens: 1,
          },
          total_cost_usd: 0.00031,
        }),
        false,
      );
      output = spy.mock.calls.map(([line]) => stripAnsi(String(line))).join("\n");
    } finally {
      spy.mockRestore();
    }

    expect(output).toContain("Qwen init (session: qwen-session-1, model: coder-model)");
    expect(output).toContain("assistant: hello");
    expect(output).toContain("thinking: looking at package.json");
    expect(output).toContain("tool_call: run_shell_command (call_1)");
    expect(output).toContain("result: subtype=success");
  });
});
