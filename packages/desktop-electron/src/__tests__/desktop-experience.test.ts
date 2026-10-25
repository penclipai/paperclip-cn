import { describe, expect, it } from "vitest";
import { DesktopExperience, parseDesktopContext, parseDesktopNotification, publicDesktopPreferences } from "../desktop-experience.js";

describe("DesktopExperience", () => {
  it("rejects malformed metadata and strips arbitrary renderer notification fields", () => {
    expect(parseDesktopContext({ locale: "en", companyId: "a", activeRuns: Number.MAX_SAFE_INTEGER })).toBeNull();
    expect(parseDesktopContext({ locale: "en", companyId: "", activeRuns: 0 })).toBeNull();
    expect(parseDesktopContext({ locale: "en", companyId: "a" })).toBeNull();
    expect(parseDesktopNotification({ id: "bad\n", companyId: "a", kind: "approval", targetPath: "/approvals/1" })).toBeNull();
    expect(parseDesktopNotification({ id: "1", companyId: "a", kind: "approval", targetPath: "/cli-auth/secret" })).toBeNull();
    expect(parseDesktopNotification({ id: "1", companyId: "a", kind: "approval", targetPath: "/approvals/1?secret=omit", body: "private", title: "private" }))
      .toEqual({ id: "1", companyId: "a", kind: "approval", targetPath: "/approvals/1" });
  });
  it("only delivers metadata notifications for the active company while hidden", () => {
    const experience = new DesktopExperience();
    experience.setContext({ locale: "zh-CN", companyId: "company-a", activeRuns: 3 }, 100);
    const request = { id: "event-1", companyId: "company-a", kind: "run_failed" as const, targetPath: "/company/a" };

    expect(experience.shouldDeliverNotification(request, {
      hiddenOrUnfocused: false, notificationsEnabled: true, supported: true,
    })).toBe(false);
    expect(experience.shouldDeliverNotification({ ...request, companyId: "company-b" }, {
      hiddenOrUnfocused: true, notificationsEnabled: true, supported: true,
    })).toBe(false);
    expect(experience.shouldDeliverNotification(request, {
      hiddenOrUnfocused: true, notificationsEnabled: true, supported: true,
    })).toBe(true);

    experience.rememberNotification(request.id);
    expect(experience.shouldDeliverNotification(request, {
      hiddenOrUnfocused: true, notificationsEnabled: true, supported: true,
    })).toBe(false);
  });

  it("expires stale active-run context and clears notification dedupe on company switch", () => {
    const experience = new DesktopExperience();
    experience.setContext({ locale: "en", companyId: "company-a", activeRuns: 2 }, 100);
    expect(experience.getFreshActiveRuns(60_099)).toBe(2);
    expect(experience.getFreshActiveRuns(60_101)).toBeNull();
    experience.rememberNotification("event-1");
    experience.setContext({ locale: "en", companyId: "company-b", activeRuns: null }, 200);
    expect(experience.shouldDeliverNotification({
      id: "event-1", companyId: "company-b", kind: "approval", targetPath: "/company/b",
    }, { hiddenOrUnfocused: true, notificationsEnabled: true, supported: true })).toBe(true);
  });

  it("exposes only user preference booleans and shell capabilities", () => {
    expect(publicDesktopPreferences({ theme: "dark", window: {
      bounds: { x: 1, y: 2, width: 3, height: 4 }, maximized: true,
    } }, { trayAvailable: true, notificationsSupported: false })).toEqual({
      closeToTray: true, notificationsEnabled: true, trayAvailable: true, notificationsSupported: false,
    });
  });

  it("bounds bursts of native notifications and permits the next time window", () => {
    const experience = new DesktopExperience();
    experience.setContext({ locale: "en", companyId: "company-a", activeRuns: null }, 0);
    for (let index = 0; index < 6; index += 1) {
      const request = { id: `event-${index}`, companyId: "company-a", kind: "approval" as const, targetPath: "/company/a" };
      expect(experience.shouldDeliverNotification(request, {
        hiddenOrUnfocused: true, notificationsEnabled: true, supported: true, now: 100,
      })).toBe(true);
      experience.rememberNotification(request.id, 100);
    }
    expect(experience.shouldDeliverNotification({
      id: "event-later", companyId: "company-a", kind: "approval", targetPath: "/company/a",
    }, { hiddenOrUnfocused: true, notificationsEnabled: true, supported: true, now: 100 })).toBe(false);
    expect(experience.shouldDeliverNotification({
      id: "event-next-window", companyId: "company-a", kind: "approval", targetPath: "/company/a",
    }, { hiddenOrUnfocused: true, notificationsEnabled: true, supported: true, now: 60_100 })).toBe(true);
  });
});
