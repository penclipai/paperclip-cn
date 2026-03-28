import { describe, expect, it } from "vitest";
import {
  createLocalizedDefaultDraftUpdater,
  syncLocalizedDefaultDraft,
} from "./localized-draft";

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

  it("snapshots the previous default before later bookkeeping updates it", () => {
    let previousDefaultValue = "你是 CEO，负责为公司设定方向。";
    const updater = createLocalizedDefaultDraftUpdater(
      previousDefaultValue,
      "You are the CEO. You set the direction for the company.",
    );

    previousDefaultValue = "You are the CEO. You set the direction for the company.";

    expect(updater("你是 CEO，负责为公司设定方向。")).toBe(
      "You are the CEO. You set the direction for the company.",
    );
  });
});
