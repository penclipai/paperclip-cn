// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import { RuntimeTestCard, type TestState } from "./RuntimeTestCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cases: Array<{
  variant: "connection" | "prerequisites";
  state: TestState | "warn";
  title: string;
  description: string;
  action: string;
}> = [
  {
    variant: "connection",
    state: "idle",
    title: "Test your agent",
    description: "Check that your runtime and model can respond.",
    action: "Run test",
  },
  {
    variant: "connection",
    state: "warn",
    title: "Connection needs attention",
    description: "Review the test details before running your agent.",
    action: "Test again",
  },
  {
    variant: "connection",
    state: "fail",
    title: "Couldn't connect",
    description: "Check your model and provider connection, then try again.",
    action: "Retry test",
  },
  {
    variant: "prerequisites",
    state: "idle",
    title: "Check prerequisites",
    description: "Check instance settings and public connection configuration.",
    action: "Check setup",
  },
  {
    variant: "prerequisites",
    state: "pass",
    title: "Setup checks passed",
    description: "Review the setup details before assigning work.",
    action: "Check again",
  },
  {
    variant: "prerequisites",
    state: "fail",
    title: "Prerequisite check failed",
    description: "Review the setup details and retry.",
    action: "Retry check",
  },
];

afterEach(() => {
  document.body.innerHTML = "";
});

it.each(cases)("localizes $variant $state runtime-test copy", async ({ variant, state, title, description, action }) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    await act(async () => {
      root.render(
        <RuntimeTestCard
          variant={variant}
          state={state}
          result={null}
          onTest={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain(title);
    expect(container.textContent).toContain(description);
    expect(container.textContent).toContain(action);
  } finally {
    act(() => root.unmount());
  }
});

it("updates prerequisite copy on a locale switch without remounting the card", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await act(async () => {
      await i18n.changeLanguage("en");
      root.render(<RuntimeTestCard variant="prerequisites" state="running" result={null} onTest={vi.fn()} />);
    });

    const card = container.querySelector("section");
    expect(card).not.toBeNull();
    expect(container.textContent).toContain("Checking…");

    await act(async () => {
      await i18n.changeLanguage("zh-CN");
    });

    expect(container.querySelector("section")).toBe(card);
    expect(container.textContent).toContain("正在检查前置条件");
    expect(container.textContent).toContain("检查中…");
  } finally {
    await act(async () => {
      root.unmount();
      await i18n.changeLanguage("en");
    });
  }
});

it("shows the installation repair directly on a missing runtime test", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const message = "The ACPX claude runtime is incomplete: required package @agentclientprotocol/claude-agent-acp is missing. Reinstall or rebuild Paperclip with its bundled provider dependencies, restart the server, then test the agent's runtime before retrying.";

  try {
    await act(async () => {
      await i18n.changeLanguage("en");
      root.render(
        <RuntimeTestCard
          state="fail"
          onTest={vi.fn()}
          result={{
            adapterType: "paperclip_runner",
            status: "fail",
            testedAt: "2026-10-11T11:19:14Z",
            checks: [{ code: "acpx_runtime_package_missing", level: "error", message }],
          }}
        />,
      );
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Runtime missing");
    expect(alert?.textContent).toContain(message);
    expect(container.textContent).not.toContain("Check your model and provider connection");
  } finally {
    await act(async () => {
      root.unmount();
      await i18n.changeLanguage("en");
    });
  }
});
