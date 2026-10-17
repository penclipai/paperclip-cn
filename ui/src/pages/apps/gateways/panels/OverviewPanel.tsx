import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import { Copy } from "lucide-react";
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
  useTranslation();
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
      pushToast({ title: translateInstant("Copied"), body: label, tone: "success" });
    } catch {
      pushToast({ title: translateInstant("Copy failed"), body: "Clipboard access is unavailable.", tone: "error" });
    }
  }

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border p-4">
          <div className="text-xs font-medium text-muted-foreground">{on ? translateInstant("On") : translateInstant("Off")}</div>
          <div className="mt-2">
            <ToggleSwitch checked={on} disabled={toggleDisabled} onCheckedChange={onToggle} aria-label={translateInstant("apps.gateways.overview.toggleAriaLabel")} />
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{translateInstant("apps.gateways.overview.toggleHelp")}</p>
        </div>
        <StatCard label={translateInstant("apps.gateways.overview.appsStat")}>
          {apps.length} {apps.length === 1 ? translateInstant("apps.gateways.activity.fallbackApp") : "apps"}
          {profile ? ` · ${allowedToolsLabel(profile)}` : ""}
        </StatCard>
        <StatCard label={translateInstant("Tokens")}>
          {active} {translateInstant("active")}{expiring > 0 ? ` · ${expiring} expiring` : ""}
        </StatCard>
        <StatCard label={translateInstant("apps.gateways.overview.healthStat")}>
          {needsAttention.length === 0 ? translateInstant("apps.gateways.overview.healthGood") : `${needsAttention.length} needs attention`}
        </StatCard>
      </div>

      <section className="rounded-lg border border-border p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{translateInstant("apps.gateways.overview.whoCanUseItTitle")}</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {translateInstant("apps.gateways.overview.whoCanUseItBody")}</p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Chip>{translateInstant("Scope ·")}{" "}{formatScope(gateway, projectNames, agentNames)}</Chip>
          <Chip>{translateInstant("Profile ·")}{" "}{profile?.name ?? translateInstant("apps.gateways.overview.unavailable")}</Chip>
          <Chip>{active} {translateInstant("active")}{" "}{active === 1 ? "token" : translateInstant("issuesList.tokens")}</Chip>
        </div>
      </section>

      <section className="rounded-lg border border-border p-4">
        <h3 className="text-sm font-semibold text-foreground">{translateInstant("apps.gateways.overview.appsInGatewayTitle")}</h3>
        {apps.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            {translateInstant("apps.gateways.overview.appsEmpty")}</p>
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
          <h3 className="text-sm font-semibold text-foreground">{translateInstant("apps.gateways.overview.clientConnectTitle")}</h3>
          <Button variant="outline" size="sm" onClick={() => void copy(snippet, "Client config")}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            {translateInstant("apps.gateways.overview.copy")}</Button>
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
  useTranslation();
  const href = app.connection
    ? `/apps/${app.connection.id}/permissions`
    : `/apps/app/${app.application.id}/permissions`;
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <Link to={href} className="font-medium text-foreground hover:underline">
          {gatewayAppDisplayName(app)}
        </Link>
        <div className="text-xs text-muted-foreground">
          {app.toolCount} {app.toolCount === 1 ? translateInstant("apps.gateways.activity.fallbackTool") : "tools"}
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
        {app.needsAttention ? translateInstant("Needs attention") : translateInstant("Healthy")}
      </span>
    </li>
  );
}
