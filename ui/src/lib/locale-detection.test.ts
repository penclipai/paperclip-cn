import { describe, expect, it } from "vitest";
import {
  convertDetectedUiLocale,
  parseSupportedDetectedLocale,
} from "./locale-detection";

describe("locale detection helpers", () => {
  it("normalizes supported detected locales", () => {
    expect(parseSupportedDetectedLocale("en-US")).toBe("en");
    expect(parseSupportedDetectedLocale("zh-TW")).toBe("zh-CN");
  });

  it("leaves unsupported detected locales untouched so fallback can continue", () => {
    expect(parseSupportedDetectedLocale("fr-FR")).toBeNull();
    expect(convertDetectedUiLocale("fr-FR")).toBe("fr-FR");
  });
});
