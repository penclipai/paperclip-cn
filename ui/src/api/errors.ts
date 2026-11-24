/**
 * Shared error classification and user-facing copy.
 *
 * Every surface that reacts to a failed request asks two questions: "is this a
 * blip that will fix itself?" and "what do I tell the user?". This module is
 * the single answer to both, so retry policy, the connectivity banner, toasts,
 * and inline errors agree with each other.
 *
 * Classification is structural on purpose: it reads `status`, `code`, `body`,
 * and `name` instead of importing `ApiError`/`ApiUnavailableError`, so the API
 * client can depend on this module without an import cycle, and errors thrown
 * by hand-rolled fetches (health, uploads) classify the same way.
 */
import { getCurrentLocale, translateInstant } from "@/i18n";

export type ErrorKind =
  | "transient"
  | "auth"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "aborted"
  | "unknown";

export interface ErrorDescription {
  title: string;
  body: string;
  /** True when trying the same request again later can succeed. */
  retryable: boolean;
}

export interface DescribeErrorOptions {
  /** What the user was doing, as a verb phrase: "save the comment". */
  action?: string;
}

/** HTTP statuses that mean "the server or a proxy will likely recover". */
const TRANSIENT_STATUSES = new Set([408, 425, 429, 502, 503, 504]);

/**
 * Error codes that mean "temporarily unavailable" regardless of the HTTP status
 * they arrive with. The Cloud gateway has sent `tenant_app_unavailable` with
 * non-5xx statuses, so these are matched by code, never by status alone.
 */
const TRANSIENT_CODES = new Set([
  "tenant_app_unavailable",
  "tenant_app_starting",
  // Plugin bridge (`PluginBridgeErrorCode`).
  "WORKER_UNAVAILABLE",
  "TIMEOUT",
]);

/** Transient errors that say "the whole server is unreachable", not one route. */
const CONNECTIVITY_STATUSES = new Set([502, 503, 504]);
const CONNECTIVITY_CODES = new Set(["tenant_app_unavailable", "tenant_app_starting"]);

// --- Copy table ---------------------------------------------------------------
//
// The only place user-facing error copy lives. Keys are server error codes (the
// raw `body.error`/`body.code`) or an `ErrorKind` fallback. Never return a raw
// code to the user: anything not in this table falls back to its kind's copy.

const UNAVAILABLE_BODY = "Paperclip is temporarily unavailable. Please try again in a moment.";

const CODE_COPY: Record<string, { title: string; body: string }> = {
  tenant_app_unavailable: {
    title: "Reconnecting to Paperclip",
    body: "Paperclip is restarting or updating. Please try again in a moment.",
  },
  tenant_app_starting: {
    title: "Paperclip is starting",
    body: "Paperclip is starting up. Please try again in a few seconds.",
  },
  WORKER_UNAVAILABLE: {
    title: "Plugin unavailable",
    body: "This plugin is restarting. Please try again in a moment.",
  },
  TIMEOUT: {
    title: "Request timed out",
    body: "This took too long to respond. Please try again in a moment.",
  },
  // Issue-thread interaction resolution (moved from lib/interaction-resolution-error.ts).
  interaction_audience_denied: {
    title: "You can’t respond to this card",
    body: "You are not in this card's resolver audience.",
  },
  interaction_forbidden: {
    title: "You can’t respond to this card",
    body: "You do not have permission to respond to this card.",
  },
  interaction_settled: {
    title: "Already handled",
    body: "This request is no longer waiting for a decision.",
  },
  interaction_submit_failed: {
    title: "Couldn't submit",
    body: "Couldn't submit. Try again.",
  },
};

const KIND_COPY: Record<ErrorKind, { title: string; body: string }> = {
  // Moved from `ApiUnavailableError` (api/response.ts).
  transient: { title: "Connection interrupted", body: UNAVAILABLE_BODY },
  auth: { title: "Signed out", body: "Your session has ended. Sign in again to continue." },
  forbidden: { title: "Not allowed", body: "You don’t have permission to do that." },
  not_found: { title: "Not found", body: "This item doesn’t exist or was moved." },
  conflict: { title: "Out of date", body: "This changed since you loaded it. Refresh and try again." },
  invalid: { title: "Check your input", body: "Some details aren’t valid. Review them and try again." },
  aborted: { title: "Cancelled", body: "The request was cancelled." },
  unknown: { title: "Something went wrong", body: "An unexpected error occurred. Please try again." },
};

/**
 * Titles for the application-owned action phrases passed by shared mutation
 * helpers. Keep the caller's raw action out of zh-CN titles: concatenating it
 * into "Couldn't …" creates an English fragment rather than a sentence.
 */
const ACTION_COPY: Record<string, { key: string; title: string }> = {
  "load active runs": { key: "loadActiveRuns", title: "Couldn't load active runs" },
  "load agents": { key: "loadAgents", title: "Couldn't load agents" },
  "load connection permissions": { key: "loadConnectionPermissions", title: "Couldn't load connection permissions" },
  "load connections": { key: "loadConnections", title: "Couldn't load connections" },
  "load general settings": { key: "loadGeneralSettings", title: "Couldn't load general settings" },
  "load plugins": { key: "loadPlugins", title: "Couldn't load plugins" },
  "load bundled plugins": { key: "loadBundledPlugins", title: "Couldn't load bundled plugins" },
  "load this workspace": { key: "loadThisWorkspace", title: "Couldn't load this workspace" },
  "load this skill": { key: "loadThisSkill", title: "Couldn't load this skill" },
  "load this access request": { key: "loadAccessRequest", title: "Couldn't load this access request" },
  "load saved access": { key: "loadSavedAccess", title: "Couldn't load saved access" },
  "load organizations": { key: "loadOrganizations", title: "Couldn't load organizations" },
  "load user access": { key: "loadUserAccess", title: "Couldn't load user access" },
  "load the audit log": { key: "loadAuditLog", title: "Couldn't load the audit log" },
  "load the CLI auth challenge": { key: "loadCliAuthChallenge", title: "Couldn't load the CLI auth challenge" },
  "load routine activity": { key: "loadRoutineActivity", title: "Couldn't load routine activity" },
  "load proposals": { key: "loadProposals", title: "Couldn't load proposals" },
  "load the preview": { key: "loadPreview", title: "Couldn't load the preview" },
  "load the board claim challenge": { key: "loadBoardClaimChallenge", title: "Couldn't load the board claim challenge" },
  "load connection reviews": { key: "loadConnectionReviews", title: "Couldn't load connection reviews" },
  "load profiles": { key: "loadProfiles", title: "Couldn't load profiles" },
  "load the folder": { key: "loadFolder", title: "Couldn't load the folder" },
  "load invites": { key: "loadInvites", title: "Couldn't load invites" },
  "load the run log": { key: "loadRunLog", title: "Couldn't load the run log" },
  "approve the join request": { key: "approveJoinRequest", title: "Couldn't approve the join request" },
  "approve this request": { key: "approveRequest", title: "Couldn't approve this request" },
  "archive the card": { key: "archiveCard", title: "Couldn't archive the card" },
  "archive the task": { key: "archiveTask", title: "Couldn't archive the task" },
  "change responsibility": { key: "changeResponsibility", title: "Couldn't change responsibility" },
  "check the monitor": { key: "checkMonitor", title: "Couldn't check the monitor" },
  "connect Dot": { key: "connectDot", title: "Couldn't connect Dot" },
  "copy to the clipboard": { key: "copyToClipboard", title: "Couldn't copy to the clipboard" },
  "create the routine": { key: "createRoutine", title: "Couldn't create the routine" },
  "create the task": { key: "createTask", title: "Couldn't create the task" },
  "create the trigger": { key: "createTrigger", title: "Couldn't create the trigger" },
  "delete the folder": { key: "deleteFolder", title: "Couldn't delete the folder" },
  "delete the trigger": { key: "deleteTrigger", title: "Couldn't delete the trigger" },
  "install the team": { key: "installTeam", title: "Couldn't install the team" },
  "load approvals": { key: "loadApprovals", title: "Couldn't load approvals" },
  "load task hierarchy": { key: "loadTaskHierarchy", title: "Couldn't load task hierarchy" },
  "load the Blocked tab": { key: "loadBlockedTab", title: "Couldn't load the Blocked tab" },
  "load the install preview": { key: "loadInstallPreview", title: "Couldn't load the install preview" },
  "load workspace files": { key: "loadWorkspaceFiles", title: "Couldn't load workspace files" },
  "move the routine": { key: "moveRoutine", title: "Couldn't move the routine" },
  "move the selected routines": { key: "moveSelectedRoutines", title: "Couldn't move the selected routines" },
  "post the comment": { key: "postComment", title: "Couldn't post the comment" },
  "refresh the card": { key: "refreshCard", title: "Couldn't refresh the card" },
  "reject the join request": { key: "rejectJoinRequest", title: "Couldn't reject the join request" },
  "reject this request": { key: "rejectRequest", title: "Couldn't reject this request" },
  "request a revision": { key: "requestRevision", title: "Couldn't request a revision" },
  "restore the card": { key: "restoreCard", title: "Couldn't restore the card" },
  "restore the revision": { key: "restoreRevision", title: "Couldn't restore the revision" },
  "resubmit this request": { key: "resubmitRequest", title: "Couldn't resubmit this request" },
  "revoke the connection": { key: "revokeConnection", title: "Couldn't revoke the connection" },
  "rotate the webhook secret": { key: "rotateWebhookSecret", title: "Couldn't rotate the webhook secret" },
  "run the card": { key: "runCard", title: "Couldn't run the card" },
  "save the document": { key: "saveDocument", title: "Couldn't save the document" },
  "save the folder": { key: "saveFolder", title: "Couldn't save the folder" },
  "save the inbox agent policy": { key: "saveInboxAgentPolicy", title: "Couldn't save the inbox agent policy" },
  "save the routine": { key: "saveRoutine", title: "Couldn't save the routine" },
  "save the settings": { key: "saveSettings", title: "Couldn't save the settings" },
  "send this message": { key: "sendMessage", title: "Couldn't send this message" },
  "start the routine run": { key: "startRoutineRun", title: "Couldn't start the routine run" },
  "undo the inbox archive": { key: "undoInboxArchive", title: "Couldn't undo the inbox archive" },
  "update the folder": { key: "updateFolder", title: "Couldn't update the folder" },
  "update the routine": { key: "updateRoutine", title: "Couldn't update the routine" },
  "update the trigger": { key: "updateTrigger", title: "Couldn't update the trigger" },
  "upload the file": { key: "uploadFile", title: "Couldn't upload the file" },
};

/** Copy for a specific code or kind, for callers that build their own messages. */
export function errorCopy(key: string): { title: string; body: string } {
  const copy = CODE_COPY[key] ?? KIND_COPY[key as ErrorKind] ?? KIND_COPY.unknown;
  return {
    title: translateInstant(`queryError.${key}.title`, { defaultValue: copy.title }),
    body: translateInstant(`queryError.${key}.body`, { defaultValue: copy.body }),
  };
}

function actionTitle(action: string, fallback: string): string {
  const copy = ACTION_COPY[action];
  if (copy) {
    return translateInstant(`queryError.action.${copy.key}`, { defaultValue: copy.title });
  }
  // Preserve the upstream English action-specific title. Chinese must not
  // concatenate arbitrary (possibly user- or provider-supplied) English text.
  return getCurrentLocale() === "en" ? `Couldn't ${action}` : fallback;
}

// --- Field extraction -------------------------------------------------------------

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The HTTP status an error carries, if any. */
export function errorStatus(err: unknown): number | null {
  const status = record(err)?.status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

/**
 * Every server-provided code on an error: `ApiError.code` (the raw
 * `body.error`), `body.code`, and `body.details.code`. Plugin bridge errors put
 * their code on `body.code`; HttpErrors put a machine code on `details.code`.
 */
export function errorCodes(err: unknown): string[] {
  const error = record(err);
  if (!error) return [];
  const body = record(error.body);
  const codes = [
    stringField(error.code),
    stringField(body?.error),
    stringField(body?.code),
    stringField(record(body?.details)?.code),
  ];
  return [...new Set(codes.filter((code): code is string => code !== null))];
}

/**
 * True for a machine code (`tenant_app_unavailable`, `WORKER_UNAVAILABLE`,
 * `TIMEOUT`) rather than a sentence a person wrote. Single readable words such
 * as "Forbidden" are not codes.
 */
export function isRawErrorCode(value: string): boolean {
  const text = value.trim();
  if (!text || /\s/.test(text)) return false;
  return Object.hasOwn(KIND_COPY, text) || text === "unauthorized"
    || /^[A-Za-z0-9]+(?:[_.][A-Za-z0-9]+)+$/.test(text) || /^[A-Z][A-Z0-9_]{2,}$/.test(text);
}

/** A server message that is safe to show: not a raw code, not a generic status line. */
function readableServerMessage(err: unknown): string | null {
  const error = record(err);
  const candidates = [stringField(record(error?.body)?.message), stringField(record(error?.body)?.error)];
  if (err instanceof Error) candidates.push(stringField(err.message));
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (isRawErrorCode(candidate)) continue;
    if (/^Request failed: \d+$/.test(candidate)) continue;
    if (candidate === UNAVAILABLE_BODY) continue;
    return candidate;
  }
  return null;
}

// --- Classification ---------------------------------------------------------------

function isAbortError(err: unknown): boolean {
  const name = record(err)?.name;
  return name === "AbortError" || name === "CancelledError";
}

function isNetworkTypeError(err: unknown): boolean {
  // Fetch uses different network-failure messages across browsers. Do not
  // classify arbitrary TypeErrors (programming bugs) as outages.
  return err instanceof TypeError && /fetch|network|load failed/i.test(err.message);
}

function isApiUnavailableError(err: unknown): boolean {
  return record(err)?.name === "ApiUnavailableError";
}

export function classifyError(err: unknown): ErrorKind {
  if (err === null || err === undefined) return "unknown";
  if (isAbortError(err)) return "aborted";
  if (isApiUnavailableError(err) || isNetworkTypeError(err)) return "transient";
  if (errorCodes(err).some((code) => TRANSIENT_CODES.has(code))) return "transient";

  const status = errorStatus(err);
  if (status === null) return "unknown";
  if (TRANSIENT_STATUSES.has(status)) return "transient";
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404 || status === 410) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status >= 400 && status < 500) return "invalid";
  return "unknown";
}

export function isTransientError(err: unknown): boolean {
  return classifyError(err) === "transient";
}

/**
 * A transient error that means the server as a whole is unreachable (network
 * drop, proxy 5xx, gateway "app unavailable"), as opposed to one route being
 * busy (429, a plugin worker restarting). Only these move the app-wide
 * connectivity state; per-route blips are left to query retry.
 */
export function isConnectivityError(err: unknown): boolean {
  if (isApiUnavailableError(err) || isNetworkTypeError(err)) return true;
  if (errorCodes(err).some((code) => CONNECTIVITY_CODES.has(code))) return true;
  const status = errorStatus(err);
  if (status === null || !CONNECTIVITY_STATUSES.has(status)) return false;
  // A plugin worker 503 is one route, not the server.
  return !errorCodes(err).some((code) => TRANSIENT_CODES.has(code) && !CONNECTIVITY_CODES.has(code));
}

/** HTTP 4xx other than the transient ones; retrying the same request cannot help. */
export function isClientError(err: unknown): boolean {
  const kind = classifyError(err);
  return kind === "auth" || kind === "forbidden" || kind === "not_found" || kind === "conflict" || kind === "invalid";
}

// --- Retry-After --------------------------------------------------------------------

const MAX_RETRY_AFTER_MS = 5 * 60_000;

/** Parse an HTTP `Retry-After` value (delta-seconds or HTTP-date) into milliseconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    return Math.min(Math.round(Number(text) * 1000), MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(text);
  if (Number.isNaN(date)) return null;
  return Math.min(Math.max(0, date - now), MAX_RETRY_AFTER_MS);
}

/** The server-requested delay carried by an error, if any. */
export function errorRetryAfterMs(err: unknown): number | null {
  const value = record(err)?.retryAfterMs;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// --- Copy -----------------------------------------------------------------------------

/**
 * User-facing copy for any error. Never returns a raw `snake_case` code:
 * known codes use the table above, readable server messages pass through for
 * client errors, and everything else uses the copy for its kind.
 */
export function describeError(err: unknown, options: DescribeErrorOptions = {}): ErrorDescription {
  const kind = classifyError(err);
  const retryable = kind === "transient" || kind === "unknown";
  const code = errorCodes(err).find((value) => CODE_COPY[value]);
  const coded = code ? errorCopy(code) : undefined;
  const fallback = errorCopy(kind);

  let body: string;
  if (coded) body = coded.body;
  else if (kind === "transient" || kind === "aborted") body = fallback.body;
  else body = readableServerMessage(err) ?? fallback.body;

  const title = options.action && kind !== "transient"
    ? actionTitle(options.action, coded?.title ?? fallback.title)
    : (coded?.title ?? fallback.title);
  return { title, body, retryable };
}

/**
 * The `message` for an `ApiError` built from an HTTP response: the server's own
 * text when it is readable, otherwise copy from the table. Keeps raw codes out
 * of every `{error.message}` render and `toast(err.message)` call.
 */
export function apiErrorMessage(status: number, body: unknown): string {
  const raw = stringField(record(body)?.error);
  if (raw && !isRawErrorCode(raw)) return raw;
  return describeError({ status, body, code: raw }).body;
}
