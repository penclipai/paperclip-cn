const DEFAULT_RECENT_LOG_LIMIT = 40;
const RECENT_LOG_SUMMARY_LINES = 8;

function formatErrorDetail(error: unknown): string | null {
  if (error instanceof Error) return error.message.length > 0 ? error.message : error.name;
  if (error === undefined) return null;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function summarizeRecentLogs(recentLogs: string[]): string | null {
  if (recentLogs.length === 0) return null;
  return recentLogs
    .slice(-RECENT_LOG_SUMMARY_LINES)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" | ");
}

function detectEmbeddedPostgresHint(recentLogs: string[]): string | null {
  const haystack = recentLogs.join("\n").toLowerCase();
  if (haystack.includes("could not create semaphores") || haystack.includes("semget(")) {
    return "Embedded PostgreSQL could not allocate operating-system semaphores. " +
      "Check for stale PostgreSQL IPC resources and unfinished test servers. " +
      "This is not disk exhaustion or a SQL lock limit; integration tests must not be skipped.";
  }
  if (!haystack.includes("could not create shared memory segment")) {
    if (!haystack.includes("pre-existing shared memory block is still in use")) {
      return null;
    }

    return (
      "Embedded PostgreSQL found stale shared-memory state from an older local postgres process. " +
      "Paperclip will try to clean up matching embedded postgres processes automatically; " +
      "if startup still fails, stop older local Paperclip/postgres processes and retry."
    );
  }

  return (
    "Embedded PostgreSQL bootstrap could not allocate shared memory. " +
    "On macOS, this usually means the host's kern.sysv.shm* limits are too low for another local PostgreSQL cluster. " +
    "Stop other local PostgreSQL servers or raise the shared-memory sysctls, then retry."
  );
}

export function createEmbeddedPostgresLogBuffer(limit = DEFAULT_RECENT_LOG_LIMIT): {
  append(message: unknown): void;
  getRecentLogs(): string[];
} {
  const recentLogs: string[] = [];

  return {
    append(message: unknown) {
      const text =
        typeof message === "string"
          ? message
          : message instanceof Error
            ? message.message
            : String(message ?? "");

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;
        recentLogs.push(line);
        if (recentLogs.length > limit) {
          recentLogs.splice(0, recentLogs.length - limit);
        }
      }
    },
    getRecentLogs() {
      return [...recentLogs];
    },
  };
}

export function formatEmbeddedPostgresError(
  error: unknown,
  input: {
    fallbackMessage: string;
    recentLogs?: string[];
  },
): Error {
  const recentLogs = input.recentLogs ?? [];
  const errorDetail = formatErrorDetail(error);
  const parts = [input.fallbackMessage];
  const hint = detectEmbeddedPostgresHint(errorDetail ? [errorDetail, ...recentLogs] : recentLogs);
  const recentSummary = summarizeRecentLogs(recentLogs);

  if (errorDetail && errorDetail !== input.fallbackMessage) {
    parts.push(errorDetail);
  }
  if (hint) {
    parts.push(hint);
  }
  if (recentSummary) {
    parts.push(`Recent embedded Postgres logs: ${recentSummary}`);
  }

  return new Error(parts.join(" "));
}
