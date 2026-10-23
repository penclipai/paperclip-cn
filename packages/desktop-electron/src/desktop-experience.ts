import { normalizeDesktopAppPath, type DesktopPreferences } from "./runtime.js";

export type DesktopLocale = "en" | "zh-CN";
export type DesktopNotificationKind = "approval" | "run_failed" | "run_timed_out";

export type DesktopContext = {
  locale: DesktopLocale;
  companyId: string | null;
  activeRuns: number | null;
};

export type DesktopNotificationRequest = {
  id: string;
  companyId: string;
  kind: DesktopNotificationKind;
  targetPath: string;
};

function boundedId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256
    && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isTrustedDesktopFrame(
  event: { sender: { mainFrame: unknown; getURL(): string }; senderFrame: unknown },
  contents: unknown,
  appUrl: string | null,
): boolean {
  if (!contents || event.sender !== contents || event.senderFrame !== event.sender.mainFrame || !appUrl) return false;
  try {
    return new URL(event.sender.getURL()).origin === new URL(appUrl).origin;
  } catch {
    return false;
  }
}

/** Validate and copy only the fixed metadata contract, discarding extra fields. */
export function parseDesktopContext(value: unknown): DesktopContext | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DesktopContext>;
  if ((candidate.locale !== "en" && candidate.locale !== "zh-CN")
    || (candidate.companyId !== null && !boundedId(candidate.companyId))
    || (candidate.activeRuns !== null && (!Number.isSafeInteger(candidate.activeRuns)
      || candidate.activeRuns! < 0 || candidate.activeRuns! > 1_000_000))) return null;
  return { locale: candidate.locale, companyId: candidate.companyId, activeRuns: candidate.activeRuns ?? null };
}

export function parseDesktopNotification(value: unknown): DesktopNotificationRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<DesktopNotificationRequest>;
  if (!boundedId(candidate.id) || !boundedId(candidate.companyId)
    || !["approval", "run_failed", "run_timed_out"].includes(candidate.kind ?? "")) return null;
  const targetPath = normalizeDesktopAppPath(candidate.targetPath);
  if (!targetPath) return null;
  return { id: candidate.id, companyId: candidate.companyId,
    kind: candidate.kind as DesktopNotificationKind, targetPath };
}

export type DesktopExperienceState = {
  context: DesktopContext;
  contextReceivedAt: number;
  deliveredNotificationIds: string[];
  notificationTimestamps: number[];
};

const MAX_NOTIFICATION_IDS = 100;
const ACTIVE_RUNS_TTL_MS = 60_000;
const NOTIFICATION_WINDOW_MS = 60_000;
const MAX_NOTIFICATIONS_PER_WINDOW = 6;

/**
 * Keeps the private, metadata-only state for the desktop shell. This module
 * intentionally has no Electron imports so the trust and notification policy
 * can be tested without a native runtime.
 */
export class DesktopExperience {
  private state: DesktopExperienceState = {
    context: { locale: "en", companyId: null, activeRuns: null },
    contextReceivedAt: 0,
    deliveredNotificationIds: [],
    notificationTimestamps: [],
  };

  setContext(context: DesktopContext, now = Date.now()): void {
    const changedCompany = context.companyId !== this.state.context.companyId;
    this.state.context = {
      locale: context.locale,
      companyId: context.companyId,
      activeRuns: Number.isInteger(context.activeRuns) && context.activeRuns! >= 0
        ? context.activeRuns
        : null,
    };
    this.state.contextReceivedAt = now;
    if (changedCompany) {
      this.state.deliveredNotificationIds = [];
    }
  }

  getContext(): DesktopContext {
    return { ...this.state.context };
  }

  getFreshActiveRuns(now = Date.now()): number | null {
    if (this.state.context.companyId === null) return null;
    if (now - this.state.contextReceivedAt > ACTIVE_RUNS_TTL_MS) return null;
    return this.state.context.activeRuns;
  }

  shouldDeliverNotification(
    request: DesktopNotificationRequest,
    input: { hiddenOrUnfocused: boolean; notificationsEnabled: boolean; supported: boolean; now?: number },
  ): boolean {
    if (!input.hiddenOrUnfocused || !input.notificationsEnabled || !input.supported) return false;
    if (request.companyId !== this.state.context.companyId) return false;
    if (this.state.deliveredNotificationIds.includes(request.id)) return false;
    const now = input.now ?? Date.now();
    this.state.notificationTimestamps = this.state.notificationTimestamps.filter(
      (timestamp) => now - timestamp < NOTIFICATION_WINDOW_MS,
    );
    if (this.state.notificationTimestamps.length >= MAX_NOTIFICATIONS_PER_WINDOW) return false;
    return true;
  }

  rememberNotification(id: string, now = Date.now()): void {
    if (this.state.deliveredNotificationIds.includes(id)) return;
    this.state.deliveredNotificationIds.push(id);
    if (this.state.deliveredNotificationIds.length > MAX_NOTIFICATION_IDS) {
      this.state.deliveredNotificationIds.splice(0, this.state.deliveredNotificationIds.length - MAX_NOTIFICATION_IDS);
    }
    this.state.notificationTimestamps.push(now);
  }
}

export function publicDesktopPreferences(
  preferences: DesktopPreferences,
  capabilities: { trayAvailable: boolean; notificationsSupported: boolean },
): {
  closeToTray: boolean;
  notificationsEnabled: boolean;
  trayAvailable: boolean;
  notificationsSupported: boolean;
} {
  return {
    closeToTray: preferences.closeToTray !== false,
    notificationsEnabled: preferences.notificationsEnabled !== false,
    trayAvailable: capabilities.trayAvailable,
    notificationsSupported: capabilities.notificationsSupported,
  };
}
