import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import en from "../../public/locales/en/common.json";
import zh from "../../public/locales/zh-CN/common.json";

const state = vi.hoisted(() => ({ translate: (key: string, _options?: Record<string, unknown>) => key }));

vi.mock("@/i18n", () => ({
  translateInstant: (key: string, options?: Record<string, unknown>) => state.translate(key, options),
}));

import { appCopyFor, credentialFieldLabel } from "./app-gallery-copy";

describe("app gallery copy", () => {
  const i18n = createInstance();
  beforeAll(async () => {
    await i18n.init({ lng: "en", fallbackLng: "en", keySeparator: false,
      resources: { en: { translation: en }, "zh-CN": { translation: zh } } });
    state.translate = (key, options) => i18n.t(key, options);
  });
  beforeEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("resolves curated copy at call time after a locale switch", async () => {
    expect(appCopyFor("google-docs").tagline).toBe("Read and update documents.");
    await i18n.changeLanguage("zh-CN");
    expect(appCopyFor("google-docs").tagline).toBe("读取并更新文档。");
  });

  it("localizes the generic fallback but preserves a third-party manifest description", async () => {
    expect(appCopyFor("custom-private-app").tagline).toBe("Give your agents access to this app.");
    await i18n.changeLanguage("zh-CN");
    expect(appCopyFor("custom-private-app").tagline).toBe("授予智能体访问此应用的权限。");
    expect(appCopyFor("custom-private-app", "Custom description from a manifest").tagline).toBe("Custom description from a manifest");
  });

  it("localizes only catalog-owned description templates while preserving provider brands", async () => {
    expect(appCopyFor("xai", "Connect Grok accounts for your agents.").tagline).toBe("Connect Grok accounts for your agents.");
    expect(appCopyFor("airtable", "Connect Airtable's provider-hosted MCP server.").tagline).toBe("Connect Airtable's provider-hosted MCP server.");

    await i18n.changeLanguage("zh-CN");

    expect(appCopyFor("xai", "Connect Grok accounts for your agents.").tagline).toBe("为你的智能体连接 Grok 账户。");
    expect(appCopyFor("airtable", "Connect Airtable's provider-hosted MCP server.").tagline).toBe("连接 Airtable 提供的托管 MCP 服务器。");
    expect(appCopyFor("fireflies", "Search meeting transcripts, read summaries and action items, and connect meeting-ready routines.").tagline)
      .toBe("搜索会议记录，阅读摘要和行动项，并连接适合会议的例行任务。");
    expect(appCopyFor("custom-private-app", "Third-party controlled description").tagline)
      .toBe("Third-party controlled description");
  });

  it("keeps app names as interpolation data in the localized credential label", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(credentialFieldLabel("GitHub", "Token", 1)).toBe("你的 GitHub 密钥");
  });
});
