import { describe, expect, it } from "vitest";
import { injectPaperclipRuntimePromptLayersIntoContext } from "../adapters/prompt-context.js";

describe("injectPaperclipRuntimePromptLayersIntoContext", () => {
  it("merges localization guidance into the existing session handoff note", () => {
    const nextContext = injectPaperclipRuntimePromptLayersIntoContext({
      paperclipSessionHandoffMarkdown: "Session handoff note.",
      paperclipLocalizationPromptMarkdown: "Runtime note.",
      other: "value",
    });

    expect(nextContext.paperclipSessionHandoffMarkdown).toBe(
      ["Session handoff note.", "Runtime note."].join("\n\n"),
    );
    expect(nextContext).not.toHaveProperty("paperclipLocalizationPromptMarkdown");
    expect(nextContext.other).toBe("value");
  });

  it("leaves the context untouched when no localization prompt exists", () => {
    const context = {
      paperclipSessionHandoffMarkdown: "Session handoff note.",
    };

    expect(injectPaperclipRuntimePromptLayersIntoContext(context)).toBe(context);
  });
});
