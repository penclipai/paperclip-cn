import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUpRight, Loader2, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AppDefinition, ToolConnection } from "@penclipai/shared";
import { credentialConfigPath, getAvailableConnectionMethod, humanizeConnectionDisplayName } from "@penclipai/shared";
import { toolsApi } from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { redactUrlSecrets } from "@/lib/redact-url-secrets";
import { navigateTopLevel } from "@/lib/browserNavigation";
import type { AppDetailSectionProps } from "./types";

export function AdvancedPanel({
  connection,
  appName,
  galleryEntry,
  removing,
  onRemove,
  onReplaced,
}: Pick<AppDetailSectionProps, "connection" | "appName" | "galleryEntry"> & {
  removing: boolean;
  onRemove: () => void;
  onReplaced: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      <KeySection connection={connection} galleryEntry={galleryEntry} onReplaced={onReplaced} />
      <TechnicalDetails connection={connection} />
      <DangerZone appName={appName} removing={removing} onRemove={onRemove} />
    </div>
  );
}

function KeySection({
  connection,
  galleryEntry,
  onReplaced,
}: {
  connection: ToolConnection;
  galleryEntry: AppDefinition | null;
  onReplaced: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between px-5 py-4">
        <div className="flex items-start gap-3">
          <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {t("apps.detail.advanced.key.title", { defaultValue: "Key" })}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("apps.detail.advanced.key.description", {
                defaultValue: "Your key is stored securely. Replace it if it stopped working or you rotated it.",
              })}
            </p>
          </div>
        </div>
        {!open && (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            {t("apps.detail.advanced.key.replace", { defaultValue: "Replace key" })}
          </Button>
        )}
      </div>
      {open && (
        <div className="border-t border-border px-5 py-4">
          <ReconnectForm
            connection={connection}
            galleryEntry={galleryEntry}
            onCancel={() => setOpen(false)}
            onReconnected={() => {
              setOpen(false);
              onReplaced();
            }}
          />
        </div>
      )}
    </section>
  );
}

export function ReconnectCard({
  connection,
  galleryEntry,
  onReconnected,
}: {
  connection: ToolConnection;
  galleryEntry: AppDefinition | null;
  onReconnected: () => void;
}) {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const reconnectOAuth = useMutation({
    mutationFn: () => toolsApi.startOAuth(connection.id),
    onSuccess: ({ authorizationUrl }) => navigateTopLevel(authorizationUrl),
    onError: (error) =>
      pushToast({
        title: t("apps.detail.oauth.startError.title", { defaultValue: "Couldn’t start sign-in" }),
        body: error instanceof Error ? error.message : t("apps.detail.common.tryAgain", { defaultValue: "Please try again." }),
        tone: "error",
      }),
  });
  const oauth = connection.authKind === "oauth";

  return (
    <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-5">
      <h2 className="text-sm font-bold text-amber-900 dark:text-amber-100">
        {oauth
          ? t("apps.detail.advanced.reconnectCard.oauthTitle", { defaultValue: "Reconnect required" })
          : t("apps.detail.advanced.reconnectCard.title", { defaultValue: "This app needs reconnecting" })}
      </h2>
      <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
        {connection.healthMessage?.trim() || (oauth
          ? t("apps.detail.advanced.reconnectCard.oauthDescription", {
              defaultValue: "Authorization expired or was revoked. Sign in again to restore access.",
            })
          : t("apps.detail.advanced.reconnectCard.description", {
              defaultValue: "The key stopped working. Paste a new one to get it back online.",
            }))}
      </p>
      <div className="mt-3">
        {oauth ? (
          <Button
            type="button"
            size="sm"
            disabled={reconnectOAuth.isPending}
            onClick={() => reconnectOAuth.mutate()}
          >
            {reconnectOAuth.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {reconnectOAuth.isPending
              ? t("apps.detail.oauth.openingSignIn", { defaultValue: "Opening sign-in…" })
              : t("apps.detail.setup.oauth.reconnect", { defaultValue: "Reconnect" })}
          </Button>
        ) : (
          <ReconnectForm connection={connection} galleryEntry={galleryEntry} onReconnected={onReconnected} />
        )}
      </div>
    </div>
  );
}

function ReconnectForm({
  connection,
  galleryEntry,
  onCancel,
  onReconnected,
}: {
  connection: ToolConnection;
  galleryEntry: AppDefinition | null;
  onCancel?: () => void;
  onReconnected: () => void;
}) {
  const { t } = useTranslation();
  const { pushToast } = useToast();
  const method = galleryEntry && Array.isArray(galleryEntry.methods)
    ? getAvailableConnectionMethod(galleryEntry)
    : null;
  const fields = (method?.credentialFields ?? []).map((field) => ({
    ...field,
    configPath: credentialConfigPath(field),
    helpUrl: method?.consoleLinks?.keys ?? method?.consoleLinks?.docs ?? "",
  }));
  const [values, setValues] = useState<Record<string, string>>({});
  const [single, setSingle] = useState("");
  const usesGallery = fields.length > 0 && !!galleryEntry;

  const reconnect = useMutation({
    mutationFn: () => {
      const credentialValues = usesGallery
        ? values
        : { "credentials.authorization": single.trim() };
      return toolsApi.reconnectConnection(connection.id, credentialValues);
    },
    onSuccess: (result) => {
      const healthy =
        result.connection.healthStatus === "healthy" || result.connection.healthStatus === "unknown";
      if (healthy) {
        pushToast({
          title: t("apps.detail.advanced.reconnect.success.title", { defaultValue: "Reconnected" }),
          body: t("apps.detail.advanced.reconnect.success.body", {
            appName: humanizeConnectionDisplayName(connection),
            defaultValue: "{{appName}} is back online.",
          }),
          tone: "success",
        });
        onReconnected();
      } else {
        pushToast({
          title: t("apps.detail.advanced.reconnect.stillFailing.title", { defaultValue: "Still not working" }),
          body: result.connection.healthMessage?.trim() || t("apps.detail.advanced.reconnect.stillFailing.body", {
            defaultValue: "That key didn't check out. Try another.",
          }),
          tone: "error",
        });
      }
    },
    onError: (error) =>
      pushToast({
        title: t("apps.detail.advanced.reconnect.error.title", { defaultValue: "That key didn't work" }),
        body: error instanceof Error ? error.message : t("apps.detail.advanced.reconnect.error.body", {
          defaultValue: "Check the key and try again.",
        }),
        tone: "error",
      }),
  });

  const filled = usesGallery
    ? fields.every((f) => f.required === false || (values[f.configPath]?.trim().length ?? 0) > 0)
    : single.trim().length > 0;

  return (
    <div className="space-y-3">
      {usesGallery ? (
        fields.map((field) => (
          <div key={field.configPath}>
            <label className="text-xs font-medium text-foreground">{field.label}</label>
            <Input
              type="password"
              autoComplete="off"
              value={values[field.configPath] ?? ""}
              onChange={(e) => setValues({ ...values, [field.configPath]: e.target.value })}
              placeholder={t("apps.detail.advanced.reconnect.fieldPlaceholder", { defaultValue: "****************" })}
              className="mt-1 h-10 font-mono"
            />
            {field.helpUrl && (
              <a
                href={field.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-foreground underline underline-offset-2"
              >
                {t("apps.detail.advanced.reconnect.help", { defaultValue: "Where do I find this?" })}
                <ArrowUpRight className="h-3 w-3" />
              </a>
            )}
          </div>
        ))
      ) : (
        <Input
          type="password"
          autoComplete="off"
          value={single}
          onChange={(e) => setSingle(e.target.value)}
          placeholder={t("apps.detail.advanced.reconnect.placeholder", { defaultValue: "Paste your new key" })}
          className="h-10 font-mono"
        />
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!filled || reconnect.isPending} onClick={() => reconnect.mutate()}>
          {reconnect.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
          {reconnect.isPending
            ? t("apps.detail.advanced.reconnect.checking", { defaultValue: "Checking..." })
            : t("apps.detail.advanced.reconnect.submit", { defaultValue: "Check & reconnect" })}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={reconnect.isPending}>
            {t("apps.detail.common.cancel", { defaultValue: "Cancel" })}
          </Button>
        )}
      </div>
    </div>
  );
}

function TechnicalDetails({ connection }: { connection: ToolConnection }) {
  const { t } = useTranslation();
  const address = connectionAddress(connection);
  const displayAddress = connection.transport === "local_stdio"
    ? t("apps.detail.advanced.technical.localCommand", { defaultValue: "Local command" })
    : address === "Not set"
      ? t("apps.detail.advanced.technical.notSet", { defaultValue: "Not set" })
      : address;
  const transportKey = connection.transport === "mcp_remote"
    ? "apps.detail.advanced.technical.transport.remoteHttp"
    : connection.transport === "local_stdio"
      ? "apps.detail.advanced.technical.transport.localCommand"
      : "apps.detail.advanced.technical.transport.unknown";
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="text-sm font-bold text-foreground">
        {t("apps.detail.advanced.technical.title", { defaultValue: "Technical details" })}
      </h2>
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-(--gtc-59)">
        <dt className="text-muted-foreground">
          {t("apps.detail.advanced.technical.address", { defaultValue: "Address" })}
        </dt>
        <dd className="break-all font-mono text-foreground">{displayAddress}</dd>
        <dt className="text-muted-foreground">
          {t("apps.detail.advanced.technical.connectionType", { defaultValue: "Connection type" })}
        </dt>
        <dd className="text-foreground">{t(transportKey, { defaultValue: connectionTransportLabel(connection.transport) })}</dd>
      </dl>
    </section>
  );
}

export function DangerZone({
  appName,
  removing,
  onRemove,
}: {
  appName: string;
  removing: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <section className="rounded-xl border border-destructive/40 bg-card">
      <div className="border-b border-destructive/40 px-5 py-3 text-sm font-bold text-destructive">
        {t("apps.detail.advanced.danger.title", { defaultValue: "Danger zone" })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-foreground">
            {t("apps.detail.advanced.danger.removeTitle", { defaultValue: "Remove this app" })}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("apps.detail.advanced.danger.removeDescription", {
              appName,
              defaultValue: "Agents lose access to {{appName}} right away. You can connect it again later.",
            })}
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={removing}>
              {t("apps.detail.common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button variant="destructive" size="sm" onClick={onRemove} disabled={removing}>
              {removing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {t("apps.detail.advanced.danger.confirmRemove", { defaultValue: "Yes, remove it" })}
            </Button>
          </div>
        ) : (
          <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
            {t("apps.detail.advanced.danger.removeButton", { defaultValue: "Remove app" })}
          </Button>
        )}
      </div>
    </section>
  );
}

export function connectionAddress(connection: ToolConnection): string {
  const config = connection.config ?? connection.transportConfig ?? {};
  const value = config.url ?? config.endpoint ?? config.remoteUrl;
  if (typeof value === "string" && value.trim().length > 0) return redactUrlSecrets(value);
  if (connection.transport === "local_stdio") return "Local command";
  return "Not set";
}

export function connectionTransportLabel(transport: ToolConnection["transport"]): string {
  if (transport === "mcp_remote") return "Remote HTTP";
  if (transport === "local_stdio") return "Local command";
  return "Unknown";
}
