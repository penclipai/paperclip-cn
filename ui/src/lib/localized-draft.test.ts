import { describe, expect, it } from "vitest";
import { syncLocalizedDefaultDraft } from "./localized-draft";

describe("syncLocalizedDefaultDraft", () => {
  it("updates untouched drafts when the localized default changes", () => {
    expect(
      syncLocalizedDefaultDraft(
        "你是 CEO，负责为公司设定方向。",
        "你是 CEO，负责为公司设定方向。",
        "You are the CEO. You set the direction for the company.",
      ),
    ).toBe("You are the CEO. You set the direction for the company.");
  });

  it("preserves user-edited drafts when the localized default changes", () => {
    expect(
      syncLocalizedDefaultDraft(
        "Custom operator instructions",
        "你是 CEO，负责为公司设定方向。",
        "You are the CEO. You set the direction for the company.",
      ),
    ).toBe("Custom operator instructions");
  });
});
