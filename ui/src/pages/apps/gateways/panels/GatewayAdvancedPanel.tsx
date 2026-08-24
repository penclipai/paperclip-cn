import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ToolMcpGatewayWithTokens } from "@penclipai/shared";
import { useNavigate } from "@/lib/router";
import { toolsApi } from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { copyTextToClipboard } from "@/lib/clipboard";
import { gatewaysQueryKey } from "../NewGatewayDialog";

/**
 * Advanced tab — raw protocol/transport details, config JSON and the archive
 * (destructive) action live here, out of the default prosumer view per the
 * PAP-11174 contract's default-vs-Advanced split.
 */
export function GatewayAdvancedPanel({
  companyId,
  gateway,
}: {
  companyId: string;
  gateway: ToolMcpGatewayWithTokens;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { pushToast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  const endpoint = `${typeof window !== "undefined" ? window.location.origin : ""}${gateway.endpointPath}`;
  const rawConfig = JSON.stringify(
    {
      gatewayPublicId: gateway.gatewayPublicId,
      displaySlug: gateway.displaySlug,
      status: gateway.status,
      profileId: gateway.profileId,
      defaultProfileMode: gateway.defaultProfileMode,
      contextScopeType: gateway.contextScopeType,
      contextScopeId: gateway.contextScopeId,
      endpointPath: gateway.endpointPath,
      authConfig: gateway.authConfig,
      headerPolicy: gateway.headerPolicy,
      metadataPolicy: gateway.metadataPolicy,
      onDemandToolsConfig: gateway.onDemandToolsConfig,
    },
    null,
    2,
  );

  const archiveMutation = useMutation({
    mutationFn: () => toolsApi.updateGateway(companyId, gateway.id, { status: "archived" }),
    onSuccess: async () => {
      pushToast({
        title: t("apps.gateways.advanced.toast.archivedTitle", { defaultValue: "Gateway archived" }),
        body: t("apps.gateways.advanced.toast.archivedBody", {
          name: gateway.name,
          defaultValue: "{{name}} is no longer reachable.",
        }),
        tone: "success",
      });
      await queryClient.invalidateQueries({ queryKey: gatewaysQueryKey(companyId) });
      navigate("/apps/gateways");
    },
    onError: (error) =>
      pushToast({
        title: t("apps.gateways.advanced.toast.archiveFailedTitle", {
          defaultValue: "Couldn't archive the gateway",
        }),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      }),
  });

  async function copy(value: string, label: string) {
    try {
      await copyTextToClipboard(value);
      pushToast({
        title: t("apps.gateways.advanced.toast.copiedTitle", { defaultValue: "Copied" }),
        body: label,
        tone: "success",
      });
    } catch {
      pushToast({
        title: t("apps.gateways.advanced.toast.copyFailedTitle", { defaultValue: "Copy failed" }),
        body: t("apps.gateways.advanced.clipboardUnavailable", {
          defaultValue: "Clipboard access is unavailable.",
        }),
        tone: "error",
      });
    }
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">
          {t("apps.gateways.advanced.transportTitle", { defaultValue: "Transport" })}
        </h3>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={t("apps.gateways.advanced.transportLabel", { defaultValue: "Transport" })} value="streamable_http" />
          <Row label={t("apps.gateways.advanced.authenticationLabel", { defaultValue: "Authentication" })} value="bearer" />
          <Row label={t("apps.gateways.advanced.protocolVersionLabel", { defaultValue: "Protocol version" })} value="2025-03-26" />
          <Row label={t("apps.gateways.advanced.publicIdLabel", { defaultValue: "Public ID" })} value={gateway.gatewayPublicId} mono />
        </dl>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 font-mono text-xs text-muted-foreground">
            {endpoint}
          </code>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy(
              endpoint,
              t("apps.gateways.advanced.endpointUrl", { defaultValue: "Endpoint URL" }),
            )}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t("apps.gateways.advanced.copy", { defaultValue: "Copy" })}
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t("apps.gateways.advanced.rawConfigTitle", { defaultValue: "Raw configuration" })}
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copy(
              rawConfig,
              t("apps.gateways.advanced.gatewayConfigJson", { defaultValue: "Gateway config JSON" }),
            )}
          >
            <Copy className="mr-1 h-3.5 w-3.5" />
            {t("apps.gateways.advanced.copyJson", { defaultValue: "Copy JSON" })}
          </Button>
        </div>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-muted-foreground">
          {rawConfig}
        </pre>
      </section>

      <section className="space-y-2 rounded-lg border border-destructive/40 p-4">
        <h3 className="text-sm font-semibold text-destructive">
          {t("apps.gateways.advanced.dangerTitle", { defaultValue: "Danger zone" })}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t("apps.gateways.advanced.dangerBody", {
            defaultValue: "Archiving takes the gateway offline for every client. Existing tokens stop working. Type the gateway name to confirm.",
          })}
        </p>
        {confirming ? (
          <div className="space-y-2">
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={gateway.name}
              aria-label={t("apps.gateways.advanced.confirmAriaLabel", {
                defaultValue: "Type the gateway name to confirm archive",
              })}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={confirmName.trim() !== gateway.name || archiveMutation.isPending}
                onClick={() => archiveMutation.mutate()}
              >
                {archiveMutation.isPending
                  ? t("apps.gateways.advanced.archiving", { defaultValue: "Archiving…" })
                  : t("apps.gateways.advanced.archive", { defaultValue: "Archive gateway" })}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setConfirming(false); setConfirmName(""); }}>
                {t("apps.gateways.advanced.cancel", { defaultValue: "Cancel" })}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirming(true)}>
            {t("apps.gateways.advanced.archive", { defaultValue: "Archive gateway" })}
          </Button>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className={mono ? "mt-0.5 font-mono text-foreground" : "mt-0.5 text-foreground"}>{value}</dd>
    </div>
  );
}
