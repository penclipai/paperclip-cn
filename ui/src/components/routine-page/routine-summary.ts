import type { RoutineDetail, RoutineListItem, RoutineTrigger } from "@penclipai/shared";
import i18n, { getCurrentLocale, translateInstant } from "@/i18n";
import { describeSchedule } from "@/components/ScheduleEditor";

const BUILT_IN_ROUTINE_TITLE_KEYS: Record<string, string> = {
  "Refresh stale summary slots": "routines.builtInTitle.refreshStaleSummarySlots",
  "Review recent agent trajectories for coaching proposals": "routines.builtInTitle.reviewRecentAgentTrajectories",
};

export function displayBuiltInRoutineTitle(
  routine: Pick<RoutineListItem, "title" | "originKind">,
): string {
  if (routine.originKind !== "built_in_agent_bundle") return routine.title;
  const key = BUILT_IN_ROUTINE_TITLE_KEYS[routine.title];
  return key ? translateInstant(key, { defaultValue: routine.title }) : routine.title;
}

export type RoutineAutomationState = "active" | "paused" | "draft" | "archived";

/** A routine without a default agent cannot run automatically, whatever its saved status. */
export function routineAutomationState(routine: Pick<RoutineDetail, "status" | "assigneeAgentId">): RoutineAutomationState {
  if (routine.status === "archived") return "archived";
  if (!routine.assigneeAgentId) return "draft";
  return routine.status === "active" ? "active" : "paused";
}

export const ROUTINE_STATE_LABELS: Record<RoutineAutomationState, string> = {
  get active() { return translateInstant("status.active", { defaultValue: "Active" }); },
  get paused() { return translateInstant("Paused", { defaultValue: "Paused" }); },
  get draft() { return translateInstant("status.draft", { defaultValue: "Draft" }); },
  get archived() { return translateInstant("status.archived", { defaultValue: "Archived" }); },
};

/** What a paused or draft routine skips; null when it would not run on its own anyway. */
export function routinePausedNotice({
  state,
  hasWebhooks,
  hasSchedule,
}: {
  state: RoutineAutomationState;
  hasWebhooks: boolean;
  hasSchedule: boolean;
}): string | null {
  if (state !== "paused" && state !== "draft") return null;
  if (hasWebhooks && hasSchedule) {
    return translateInstant("routinePage.pausedNotice.both", {
      defaultValue: "Scheduled runs are skipped and webhook events are ignored until this routine is on.",
    });
  }
  if (hasWebhooks) {
    return translateInstant("routinePage.pausedNotice.webhooks", {
      defaultValue: "Webhook events are ignored until this routine is on. The sending app gets an error.",
    });
  }
  if (hasSchedule) {
    return translateInstant("routinePage.pausedNotice.schedule", {
      defaultValue: "Scheduled runs are skipped until this routine is on.",
    });
  }
  return null;
}

/** The line beside the status switch: when the routine runs next, or why it does not. */
export function routineStatusDetail({
  state,
  nextRun,
  hasEnabledWebhook,
  hasStandingCheck,
  now,
}: {
  state: RoutineAutomationState;
  nextRun: Date | null;
  hasEnabledWebhook: boolean;
  hasStandingCheck: boolean;
  now?: Date;
}): string | null {
  if (state === "draft") return null;
  if (state === "archived") return translateInstant("routinePage.statusDetail.archived", { defaultValue: "No longer runs" });
  if (state === "paused") return translateInstant("routinePage.statusDetail.paused", { defaultValue: "Run now still works" });
  if (nextRun) return translateInstant("routinePage.statusDetail.nextRun", { when: formatNextRun(nextRun, now), defaultValue: "Next run {{when}}" });
  if (hasEnabledWebhook) return translateInstant("routinePage.statusDetail.webhook", { defaultValue: "Runs when a webhook arrives" });
  if (hasStandingCheck) return translateInstant("routinePage.statusDetail.standingCheck", { defaultValue: "Checked each time the agent wakes up" });
  return translateInstant("routinePage.statusDetail.manual", { defaultValue: "Only runs when you start it" });
}

export function nextScheduledRun(triggers: readonly RoutineTrigger[]): Date | null {
  return triggers
    .filter((trigger) => trigger.kind === "schedule" && trigger.enabled && trigger.nextRunAt)
    .map((trigger) => new Date(trigger.nextRunAt as Date))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;
}

/** "today at 9:36 AM", "tomorrow at 2:00 PM", otherwise a short dated form. */
export function formatNextRun(date: Date, now: Date = new Date()): string {
  const locale = i18n.isInitialized && i18n.hasResourceBundle(getCurrentLocale(), "common") ? getCurrentLocale() : undefined;
  const time = date.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);
  if (days === 0) return translateInstant("routinePage.nextRunToday", { time, defaultValue: `today at ${time}` });
  if (days === 1) return translateInstant("routinePage.nextRunTomorrow", { time, defaultValue: `tomorrow at ${time}` });
  const day = date.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" });
  return translateInstant("routinePage.nextRunDated", { day, time, defaultValue: `${day} at ${time}` });
}

export function describeScheduleTrigger(trigger: Pick<RoutineTrigger, "cronExpression">): string {
  return trigger.cronExpression ? describeSchedule(trigger.cronExpression) : translateInstant("routineDetail.schedule", { defaultValue: "Schedule" });
}

export function webhookTitle(trigger: Pick<RoutineTrigger, "signingMode" | "label">): string {
  const kind = trigger.signingMode === "github_hmac"
    ? translateInstant("routineWebhook.githubTitle", { defaultValue: "GitHub webhook" })
    : translateInstant("routineWebhook.genericTitle", { defaultValue: "Webhook" });
  return trigger.label ? `${kind} · ${trigger.label}` : kind;
}

export type WebhookHealth = "setup" | "testing" | "paused" | "rejected" | "receiving" | "waiting";

/** A webhook that went live before and was put back into test mode (it has a real delivery on record). */
export function webhookRetesting(trigger: Pick<RoutineTrigger, "setupPending" | "lastWebhookDelivery">): boolean {
  const delivery = trigger.lastWebhookDelivery;
  if (!trigger.setupPending || !delivery) return false;
  return delivery.test ? delivery.previous != null : true;
}

export function webhookHealth(trigger: RoutineTrigger): WebhookHealth {
  if (trigger.setupPending) return webhookRetesting(trigger) ? "testing" : "setup";
  if (!trigger.enabled) return "paused";
  if (trigger.lastWebhookDelivery?.status === "rejected") return "rejected";
  if (trigger.lastWebhookDelivery?.status === "received" && !trigger.lastWebhookDelivery.test) return "receiving";
  return "waiting";
}

export const WEBHOOK_HEALTH_LABELS: Record<WebhookHealth, string> = {
  get setup() { return translateInstant("routineWebhook.health.setup", { defaultValue: "Setup unfinished" }); },
  get testing() { return translateInstant("routineWebhook.health.testing", { defaultValue: "Testing · events don’t run" }); },
  get paused() { return translateInstant("Paused", { defaultValue: "Paused" }); },
  get rejected() { return translateInstant("routineWebhook.health.rejected", { defaultValue: "Key rejected" }); },
  get receiving() { return translateInstant("routineWebhook.health.receiving", { defaultValue: "Receiving events" }); },
  get waiting() { return translateInstant("routineWebhook.health.waiting", { defaultValue: "Waiting for the first event" }); },
};

/** Which status the webhook dialog shows; each key has one entry in WEBHOOK_STATUS_COPY. */
export type WebhookStatusKey =
  | WebhookHealth
  | "setup_testing"
  | "test_received"
  | "test_rejected"
  | "ignored_while_paused";

export function webhookStatusKey(
  trigger: RoutineTrigger,
  { routineActive, testing }: { routineActive: boolean; testing: boolean },
): WebhookStatusKey {
  const health = webhookHealth(trigger);
  // Only test deliveries count: a webhook put back into test mode still carries its last real delivery.
  const testDelivery = trigger.setupPending && trigger.lastWebhookDelivery?.test ? trigger.lastWebhookDelivery : null;
  if (testDelivery?.status === "received") return "test_received";
  if (testDelivery?.status === "rejected") return "test_rejected";
  if (!routineActive && health !== "setup" && health !== "testing") return "ignored_while_paused";
  if (health === "setup" && testing) return "setup_testing";
  return health;
}

export const WEBHOOK_STATUS_COPY: Record<WebhookStatusKey, { title: string; detail: string }> = {
  setup: {
    get title() { return translateInstant("routineWebhook.status.setup.title", { defaultValue: "Waiting for a test event" }); },
    get detail() { return translateInstant("routineWebhook.status.setup.detail", { defaultValue: "Send one from your app. Test events never start the routine." }); },
  },
  setup_testing: {
    get title() { return translateInstant("routineWebhook.status.setup.title", { defaultValue: "Waiting for a test event" }); },
    get detail() { return translateInstant("routineWebhook.status.setupTesting.detail", { defaultValue: "Send one from your app. It won’t start the routine. Real events are ignored until you finish testing." }); },
  },
  testing: {
    get title() { return translateInstant("routineWebhook.status.testing.title", { defaultValue: "Testing" }); },
    get detail() { return translateInstant("routineWebhook.status.testing.detail", { defaultValue: "Send an event from your app. It won’t start the routine. Real events are ignored until you finish testing." }); },
  },
  waiting: {
    get title() { return translateInstant("routineWebhook.status.waiting.title", { defaultValue: "Ready" }); },
    get detail() { return translateInstant("routineWebhook.status.waiting.detail", { defaultValue: "The next event starts this routine." }); },
  },
  receiving: {
    get title() { return translateInstant("routineWebhook.health.receiving", { defaultValue: "Receiving events" }); },
    get detail() { return translateInstant("routineWebhook.status.receiving.detail", { defaultValue: "Each event starts this routine." }); },
  },
  rejected: {
    get title() { return translateInstant("routineWebhook.status.rejected.title", { defaultValue: "The last event was rejected" }); },
    get detail() { return translateInstant("routineWebhook.status.rejected.detail", { defaultValue: "The key didn’t match. Replace the key, then paste the new one into your app." }); },
  },
  test_rejected: {
    get title() { return translateInstant("routineWebhook.status.rejected.title", { defaultValue: "The last event was rejected" }); },
    get detail() { return translateInstant("routineWebhook.status.rejected.detail", { defaultValue: "The key didn’t match. Replace the key, then paste the new one into your app." }); },
  },
  test_received: {
    get title() { return translateInstant("routineWebhook.status.testReceived.title", { defaultValue: "Test event received" }); },
    get detail() { return translateInstant("routineWebhook.status.testReceived.detail", { defaultValue: "The connection works. No task was created." }); },
  },
  ignored_while_paused: {
    get title() { return translateInstant("routineWebhook.status.ignoredWhilePaused.title", { defaultValue: "Ignoring events while the routine is paused" }); },
    get detail() { return translateInstant("routineWebhook.status.ignoredWhilePaused.detail", { defaultValue: "Turn the routine on to start it from this webhook. Until then the sending app gets an error." }); },
  },
  paused: {
    get title() { return translateInstant("Paused", { defaultValue: "Paused" }); },
    get detail() { return translateInstant("routineWebhook.status.paused.detail", { defaultValue: "Events are ignored until you resume this webhook." }); },
  },
};

/** Plain-language lines for saved run rules that differ from the defaults. Empty for most routines. */
export function customRunRules(
  routine: Pick<RoutineDetail, "concurrencyPolicy" | "catchUpPolicy" | "activityGatePolicy" | "activityGateScope">,
): string[] {
  const rules: string[] = [];
  if (routine.concurrencyPolicy === "always_enqueue") rules.push(translateInstant("routinePage.runRule.alwaysEnqueue", { defaultValue: "Queues every run, even while one is still working" }));
  if (routine.concurrencyPolicy === "skip_if_active") rules.push(translateInstant("routinePage.runRule.skipIfActive", { defaultValue: "Skips a run while one is still working" }));
  if (routine.catchUpPolicy === "enqueue_missed_with_cap") rules.push(translateInstant("routinePage.runRule.catchUp", { defaultValue: "Catches up on runs missed while paused" }));
  if (routine.activityGatePolicy === "require_external_activity") {
    rules.push(
      routine.activityGateScope === "project"
        ? translateInstant("routinePage.runRule.requireActivityProject", { defaultValue: "Skips scheduled runs when nothing changed in its project" })
        : translateInstant("routinePage.runRule.requireActivity", { defaultValue: "Skips scheduled runs when nothing changed" }),
    );
  }
  return rules;
}

/** First paragraph of the instructions; a leading heading keeps the paragraph under it. */
export function instructionsPreview(markdown: string): { preview: string; truncated: boolean } {
  const blocks = markdown.trim().split(/\n\s*\n/);
  if (blocks.length <= 1) return { preview: markdown.trim(), truncated: false };
  const take = /^#{1,6}\s/.test(blocks[0] ?? "") ? 2 : 1;
  return { preview: blocks.slice(0, take).join("\n\n"), truncated: blocks.length > take };
}
