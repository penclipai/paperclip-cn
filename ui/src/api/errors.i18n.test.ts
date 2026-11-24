import { expect, it } from "vitest";
import i18n from "i18next";
import { describeError } from "./errors";

it.each([
  ["load general settings", "无法加载常规设置"],
  ["load plugins", "无法加载插件"],
  ["load bundled plugins", "无法加载内置插件"],
  ["load this workspace", "无法加载此工作区"],
  ["load this skill", "无法加载此技能"],
  ["load this access request", "无法加载此访问申请"],
  ["load saved access", "无法加载已保存的访问权限"],
  ["load organizations", "无法加载组织"],
  ["load user access", "无法加载用户访问权限"],
  ["load the audit log", "无法加载审计日志"],
  ["load the CLI auth challenge", "无法加载 CLI 授权请求"],
  ["load routine activity", "无法加载例行任务活动"],
  ["load proposals", "无法加载提案"],
  ["load the preview", "无法加载预览"],
  ["load the board claim challenge", "无法加载实例认领请求"],
  ["load connection reviews", "无法加载连接审核列表"],
  ["load profiles", "无法加载配置列表"],
  ["load the folder", "无法加载文件夹"],
])("localizes the retry title for %s", async (action, chineseTitle) => {
  const error = { status: 500, body: { message: "Provider X unavailable" } };
  expect(describeError(error, { action }).title).toBe(`Couldn't ${action}`);
  try {
    await i18n.changeLanguage("zh-CN");
    expect(describeError(error, { action })).toMatchObject({
      title: chineseTitle,
      body: "Provider X unavailable",
      retryable: true,
    });
  } finally {
    await i18n.changeLanguage("en");
  }
});
