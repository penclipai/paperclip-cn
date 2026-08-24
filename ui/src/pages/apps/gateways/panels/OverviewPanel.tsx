import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolMcpGatewayWithTokens, ToolProfileWithDetails } from "@penclipai/shared";
import { Link } from "@/lib/router";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { useToast } from "@/context/ToastContext";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import {
  activeTokenCount,
  allowedToolsLabel,
  expiringTokenCount,
  formatScope,
  type GatewayAppRow,
  gatewayAppDisplayName,
  isGatewayOn,
} from "../gateway-helpers";

export function OverviewPanel({
  gateway,
  profile,
  apps,
  agentNames,
  projectNames,
  toggleDisabled,
  onToggle,
}: {
  gateway: ToolMcpGatewayWithTokens;
  profile: ToolProfileWithDetails | undefined;
  apps: GatewayAppRow[];
  agentNames: Map<string, string>;
  projectNames: Map<string, string>;
  toggleDisabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}${gateway.endpointPath}`;
  const active = activeTokenCount(gateway);
  const expiring = expiringTokenCount(gateway);
  const needsAttention = apps.filter((app) => app.needsAttention);
  const on = isGatewayOn(gateway);

  const snippet = [
    "{",
    '  "mcpServers": {',
    `    "paperclip-${gateway.displaySlug}": {`,
    `      "url": "${endpoint}",`,
    '      "headers": { "Authorization": "Bearer pcgw_•••_TOKEN" }',
    "    }",
    "  }",
    "}",
  ].join("\n");

  async function copy(value: string, label: string) {
    try {
      await copyTextToClipboard(value);
      pushToast({
        title: t("apps.gateways.overview.toast.copiedTitle", { defaultValue: "Copied" }),
        body: label,
        tone: "success",
      });
    } catch {
      pushToast({
        title: t("apps.gateways.overview.toast.copyFailedTitle", { defaultValue: "Copy failed" }),
        body: t("apps.gateways.overview.clipboardUnavailable", {
          defaultValue: "Clipboard access is unavailable.",
        }),
        tone: "error",
      });
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs font-medium text-muted-foreground">
            {on
              ? t("apps.gateways.overview.gatewayOn", { defaultValue: "On" })
              : t("apps.gateways.overview.gatewayOff", { defaultValue: "Off" })}
          </div>
          <div className="mt-2">
            <ToggleSwitch
              checked={on}
              disabled={toggleDisabled}
              onCheckedChange={onToggle}
              aria-label={t("apps.gateways.overview.toggleAriaLabel", { defaultValue: "Toggle gateway" })}
            />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("apps.gateways.overview.toggleHelp", { defaultValue: "Toggle the whole gateway off here." })}
          </p>
        </div>
        <StatCard label={t("apps.gateways.overview.appsStat", { defaultValue: "Apps" })}>
          {t("apps.gateways.overview.appsCount", {
            count: apps.length,
            defaultValue: "{{count}} apps",
          })}
          {profile ? ` · ${allowedToolsLabel(profile)}` : ""}
        </StatCard>
        <StatCard label={t("apps.gateways.overview.tokensStat", { defaultValue: "Tokens" })}>
          {expiring > 0
            ? t("apps.gateways.overview.tokensSummaryWithExpiring", {
                active,
                expiring,
                defaultValue: "{{active}} active · {{expiring}} expiring",
              })
            : t("apps.gateways.overview.tokensSummary", {
                active,
                defaultValue: "{{active}} active",
              })}
        </StatCard>
        <StatCard label={t("apps.gateways.overview.healthStat", { defaultValue: "Health" })}>
          {needsAttention.length === 0
            ? t("apps.gateways.overview.healthGood", { defaultValue: "All green" })
            : t("apps.gateways.overview.healthNeedsAttention", {
                count: needsAttention.length,
                defaultValue: "{{count}} need attention",
              })}
        </StatCard>
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {t("apps.gateways.overview.whoCanUseItTitle", { defaultValue: "Who can use it" })}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("apps.gateways.overview.whoCanUseItBody", {
                defaultValue: "Anyone holding an active token below, restricted by the rules in the bound profile.",
              })}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip>{t("apps.gateways.overview.scopeChip", { defaultValue: "Scope" })} · {formatScope(gateway, projectNames, agentNames)}</Chip>
          <Chip>
            {t("apps.gateways.overview.profileChip", { defaultValue: "Profile" })} ·{" "}
            {profile?.name ?? t("apps.gateways.overview.unavailable", { defaultValue: "Unavailable" })}
          </Chip>
          <Chip>
            {t("apps.gateways.overview.activeTokenCount", {
              count: active,
              defaultValue: "{{count}} active tokens",
            })}
          </Chip>
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t("apps.gateways.overview.appsInGatewayTitle", { defaultValue: "Apps in this gateway" })}
        </h3>
        {apps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("apps.gateways.overview.appsEmpty", {
              defaultValue: "This gateway’s profile doesn’t include any apps yet.",
            })}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border">
            {apps.map((app) => (
              <AppRow key={app.application.id} app={app} />
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {t("apps.gateways.overview.clientConnectTitle", { defaultValue: "How clients connect" })}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void copy(snippet, t("apps.gateways.overview.clientConfig", { defaultValue: "Client config" }))}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t("apps.gateways.overview.copy", { defaultValue: "Copy" })}
          </Button>
        </div>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-3 font-mono text-xs text-muted-foreground">
          {snippet}
        </pre>
      </section>
    </div>
  );
}

function StatCard({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-2 text-sm font-semibold text-foreground">{children}</div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground">
      {children}
    </span>
  );
}

function AppRow({ app }: { app: GatewayAppRow }) {
  const { t } = useTranslation();
  const href = app.connection ? `/apps/${app.connection.id}/setup` : `/apps/app/${app.application.id}/setup`;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <Link to={href} className="font-medium text-foreground hover:underline">
          {gatewayAppDisplayName(app)}
        </Link>
        <div className="text-xs text-muted-foreground">
          {t("apps.gateways.common.toolsCount", {
            count: app.toolCount,
            defaultValue: "{{count}} tools",
          })}
          {app.needsAttention && app.attentionReason ? ` · ${app.attentionReason}` : ""}
        </div>
      </div>
      <span
        className={cn(
          "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
          app.needsAttention
            ? "border-foreground bg-foreground text-background"
            : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        )}
      >
        {app.needsAttention
          ? t("apps.gateways.common.needsAttention", { defaultValue: "Needs attention" })
          : t("apps.gateways.common.healthy", { defaultValue: "Healthy" })}
      </span>
    </li>
  );
}
