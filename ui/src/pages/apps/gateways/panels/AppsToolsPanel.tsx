import { useTranslation } from "react-i18next";
import type { ToolProfileWithDetails } from "@penclipai/shared";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { type GatewayAppRow, gatewayAppDisplayName } from "../gateway-helpers";

/**
 * Apps & tools tab — which apps this gateway exposes and how many tools each
 * contributes, derived from the bound access profile. Missing credentials
 * surface as "Needs attention", carried from the connection health status.
 */
export function AppsToolsPanel({
  apps,
  profile,
}: {
  apps: GatewayAppRow[];
  profile: ToolProfileWithDetails | undefined;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("apps.gateways.appsTools.descriptionPrefix", {
          defaultValue: "These apps go through this gateway. The bound profile",
        })}
        {profile ? ` (${profile.name})` : ""}
        {profile
          ? ` ${t("apps.gateways.appsTools.descriptionWithProfile", {
              tools: formatAllowedToolsSummary(profile, t),
              defaultValue: "decides which tools are allowed — {{tools}}. Change the profile under Advanced.",
            })}`
          : ` ${t("apps.gateways.appsTools.descriptionWithoutProfile", {
              defaultValue: "decides which tools are allowed. Change the profile under Advanced.",
            })}`}
      </p>

      {apps.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("apps.gateways.appsTools.empty", {
            defaultValue: "No apps are assigned to this gateway’s profile yet.",
          })}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-(--sz-32rem) text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-left text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5">
                  {t("apps.gateways.appsTools.table.app", { defaultValue: "App" })}
                </th>
                <th className="px-4 py-2.5">
                  {t("apps.gateways.appsTools.table.tools", { defaultValue: "Tools" })}
                </th>
                <th className="px-4 py-2.5">
                  {t("apps.gateways.appsTools.table.status", { defaultValue: "Status" })}
                </th>
                <th className="px-4 py-2.5 text-right" />
              </tr>
            </thead>
            <tbody>
              {apps.map((app) => {
                const href = app.connection
                  ? `/apps/${app.connection.id}/permissions`
                  : `/apps/app/${app.application.id}/permissions`;
                return (
                  <tr key={app.application.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <Link to={href} className="font-medium text-foreground hover:underline">
                        {gatewayAppDisplayName(app)}
                      </Link>
                      {app.needsAttention && app.attentionReason ? (
                        <div className="text-xs text-muted-foreground">
                          {translateGatewayAttentionReason(app.attentionReason, t)}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {t("apps.gateways.appsTools.toolCount", {
                        count: app.toolCount,
                        defaultValue: app.toolCount === 1 ? "{{count}} tool" : "{{count}} tools",
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
                          app.needsAttention
                            ? "border-foreground bg-foreground text-background"
                            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
                        )}
                      >
                        {app.needsAttention
                          ? t("apps.gateways.common.needsAttention", { defaultValue: "Needs attention" })
                          : t("apps.gateways.common.healthy", { defaultValue: "Healthy" })}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link to={href} className="text-xs font-medium text-primary hover:underline">
                        {t("apps.gateways.appsTools.open", { defaultValue: "Open →" })}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function formatAllowedToolsSummary(
  profile: ToolProfileWithDetails | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!profile) {
    return t("apps.gateways.common.profileUnavailable", { defaultValue: "Profile unavailable" });
  }
  const { accessMode, allowedToolCount, totalToolCount, excludedToolCount } = profile.summary;
  const count = accessMode === "all_except" ? Math.max(totalToolCount - excludedToolCount, 0) : allowedToolCount;
  if (count === 0) {
    return t("apps.gateways.common.noToolsAllowed", { defaultValue: "No tools allowed" });
  }
  return t("apps.gateways.common.toolsCount", {
    count,
    defaultValue: count === 1 ? "{{count}} tool" : "{{count}} tools",
  });
}

function translateGatewayAttentionReason(
  reason: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (reason === "Sign-in expired — reconnect to restore access.") {
    return t("apps.gateways.common.signInExpired", {
      defaultValue: "Sign-in expired — reconnect to restore access.",
    });
  }
  return reason;
}
