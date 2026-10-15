import type { ProviderTraceMetadata } from "@penclipai/shared";
import { Bug, CircleOff } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

export function runRequestedProviderTrace(
  contextSnapshot: Record<string, unknown> | null | undefined,
) {
  if (!contextSnapshot) return false;
  const debug = contextSnapshot.debug;
  return (
    typeof debug === "object" &&
    debug !== null &&
    !Array.isArray(debug) &&
    (debug as Record<string, unknown>).providerTrace === "raw"
  );
}

export function ProviderTraceStatusBadge({
  trace,
  requested = false,
  showOff = false,
  className,
}: {
  trace?: ProviderTraceMetadata | null;
  requested?: boolean;
  showOff?: boolean;
  className?: string;
}) {
  const { i18n, t } = useTranslation();
  const status = trace?.status;
  const expired = trace
    ? new Date(trace.expiresAt).getTime() <= Date.now()
    : false;
  const labelKey = expired
    ? "providerTrace.expired"
    : status === "capturing"
      ? "providerTrace.capturing"
      : status === "complete"
        ? "providerTrace.captured"
        : status === "incomplete"
          ? "providerTrace.incomplete"
          : status === "truncated"
            ? "providerTrace.truncated"
            : status === "expired"
              ? "providerTrace.expired"
              : status === "deleted"
                ? "providerTrace.deleted"
                : requested
                  ? "providerTrace.requested"
                  : showOff
                    ? "providerTrace.off"
                    : null;
  if (!labelKey) return null;
  const label = t(labelKey);
  const warning =
    status === "incomplete" ||
    status === "truncated" ||
    status === "expired" ||
    status === "deleted" ||
    expired;
  const Icon = labelKey === "providerTrace.off" ? CircleOff : Bug;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-(length:--text-micro) font-medium",
        labelKey === "providerTrace.off" || labelKey === "providerTrace.deleted" || labelKey === "providerTrace.expired"
          ? "border-border bg-background text-muted-foreground"
          : warning
            ? "border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300"
            : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200",
        className,
      )}
      title={
        trace
          ? t("providerTrace.summary", {
            frameCount: trace.frameCount,
            byteCount: trace.byteCount,
            expiresAt: new Date(trace.expiresAt).toLocaleString(i18n.language),
          })
          : requested
            ? t("providerTrace.requestedDescription")
            : t("providerTrace.offDescription")
      }
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}
