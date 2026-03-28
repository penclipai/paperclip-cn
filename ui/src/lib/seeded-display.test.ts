import { beforeEach, describe, expect, it, vi } from "vitest";

const { translateInstantMock } = vi.hoisted(() => ({
  translateInstantMock: vi.fn(
    (
      key: string,
      options?: Record<string, string | number | boolean | null | undefined>,
    ) => options?.defaultValue?.toString() ?? key,
  ),
}));

vi.mock("../i18n", () => ({
  translateInstant: translateInstantMock,
}));

import { displaySeededName } from "./seeded-display";

describe("displaySeededName", () => {
  beforeEach(() => {
    translateInstantMock.mockClear();
  });

  it("maps CTO labels to the CTO translation key", () => {
    expect(displaySeededName("Chief Technology Officer")).toBe(
      "Chief Technology Officer",
    );
    expect(translateInstantMock).toHaveBeenCalledWith("seededName.cto", {
      defaultValue: "Chief Technology Officer",
    });
  });

  it("keeps CEO labels mapped to the CEO translation key", () => {
    expect(displaySeededName("CEO")).toBe("CEO");
    expect(translateInstantMock).toHaveBeenCalledWith("seededName.ceo", {
      defaultValue: "CEO",
    });
  });

  it("returns non-seeded names unchanged", () => {
    expect(displaySeededName("Founding Engineer")).toBe("Founding Engineer");
    expect(translateInstantMock).not.toHaveBeenCalled();
  });
});
