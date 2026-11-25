import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import type {
  ComposioAppSetupInput,
  ComposioAppSetupResult,
  ToolConnection,
} from "@penclipai/shared";
import { toolsApi } from "@/api/tools";
import { useAccountIdentity } from "@/api/companies-query";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useToast } from "@/context/ToastContext";
import { describeError } from "@/api/errors";
import { cn } from "@/lib/utils";
import { ANALYTICS_MASK_CLASS } from "@/lib/analytics/privacy";

/** Provider authorization is performed by the backend; no task or agent run. */
export function ComposioAppSetup({
  name,
  toolkit,
  connections,
  onClose,
  onBack,
  onConnectNew,
}: {
  name: string;
  toolkit: string;
  connections: ToolConnection[];
  onClose: () => void;
  onBack?: () => void;
  onConnectNew: () => void;
}) {
  const { t } = useTranslation();
  const queries = useQueryClient();
  const { userId, settled } = useAccountIdentity();
  const { pushToast } = useToast();
  const [selectedConnectionId, setConnectionId] = useState<string | null>(null);
  const connectionId = selectedConnectionId ?? connections[0]?.id ?? "__new__";
  const [result, setResult] = useState<ComposioAppSetupResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [errorCause, setErrorCause] = useState<unknown>(null);
  const [hasError, setHasError] = useState(false);
  const connection = connections.find(
    (candidate) => candidate.id === connectionId,
  );

  async function submit(input: ComposioAppSetupInput) {
    if (busy || !connection || !settled) return;
    setConnectionId(connection.id);
    setBusy(true);
    setErrorCause(null);
    setHasError(false);
    try {
      const next = await toolsApi.setupComposioApp(
        connection.id,
        toolkit,
        input,
      );
      setResult(next);
      await queries.invalidateQueries({
        queryKey: queryKeys.tools.composioApps(connection.id),
        exact: true,
      });
      await queries.invalidateQueries({
        queryKey: queryKeys.tools.aggregatorApps(connection.id, userId),
        exact: true,
      });
      if (next.status === "connected") {
        pushToast({
          title: t("aggregatorConnect.composio.connectedToast", {
            appName: name,
          }),
          tone: "success",
        });
        onClose();
      }
    } catch (cause) {
      // Keep provider text intact via describeError, resolving at render time
      // so a locale change never preserves a pretranslated string.
      setErrorCause(cause instanceof Error ? cause : null);
      setHasError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="composio-app-account">
          {t("aggregatorConnect.composio.accountLabel")}
        </Label>
        <select
          id="composio-app-account"
          value={connectionId}
          disabled={busy}
          onChange={(event) => {
            setConnectionId(event.target.value);
            setResult(null);
            setErrorCause(null);
            setHasError(false);
          }}
          className={cn("h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", ANALYTICS_MASK_CLASS)}
        >
          {connections.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
          <option value="__new__">
            {t("aggregatorConnect.composio.connectNewAccountOption")}
          </option>
        </select>
      </div>
      {hasError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorCause != null ? describeError(errorCause).body : t("aggregatorConnect.composio.setupFailed")}
        </p>
      ) : null}
      {result ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t("aggregatorConnect.composio.finishConnecting", { appName: name })}
        </p>
      ) : null}
      {result?.authorizationUrl ? (
        <Button asChild variant="outline" className="w-full">
          <a
            href={result.authorizationUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("aggregatorConnect.composio.connectInComposio", {
              appName: name,
            })}
            <ExternalLink className="size-4" />
          </a>
        </Button>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <Button variant="ghost" disabled={busy} onClick={onBack ?? onClose}>
          {onBack ? t("common.back") : t("common.cancel")}
        </Button>
        <div className="flex items-center gap-2">
          {result && result.status !== "connected" ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void submit({ action: "start" })}
            >
              {t("aggregatorConnect.composio.getNewLink")}
            </Button>
          ) : null}
          <Button
            disabled={
              !settled || busy || (!connection && connectionId !== "__new__")
            }
            onClick={() => {
              if (connectionId === "__new__") onConnectNew();
              else
                void submit(
                  result ? { action: "complete" } : { action: "start" },
                );
            }}
          >
            {busy
              ? t("aggregatorConnect.composio.checking")
              : connectionId === "__new__"
                ? t("aggregatorConnect.composio.connectNewAccount")
                : result
                  ? t("aggregatorConnect.composio.connectedAction")
                  : t("common.continue")}
          </Button>
        </div>
      </div>
    </div>
  );
}
