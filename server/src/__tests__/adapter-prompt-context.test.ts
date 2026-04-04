import { describe, expect, it } from "vitest";
import { injectPaperclipRuntimePromptLayersIntoContext } from "../adapters/prompt-context.js";

describe("injectPaperclipRuntimePromptLayersIntoContext", () => {
  it("keeps handoff and localization guidance as separate prompt layers", () => {
    const context = {
      paperclipSessionHandoffMarkdown: "Session handoff note.",
      paperclipLocalizationPromptMarkdown: "Runtime note.",
      other: "value",
    };
    const nextContext = injectPaperclipRuntimePromptLayersIntoContext(context);

    expect(nextContext).toBe(context);
    expect(nextContext.paperclipSessionHandoffMarkdown).toBe("Session handoff note.");
    expect(nextContext.paperclipLocalizationPromptMarkdown).toBe("Runtime note.");
    expect(nextContext.other).toBe("value");
  });

  it("leaves the context untouched when no localization prompt exists", () => {
    const context = {
      paperclipSessionHandoffMarkdown: "Session handoff note.",
    };

    expect(injectPaperclipRuntimePromptLayersIntoContext(context)).toBe(context);
  });
});
