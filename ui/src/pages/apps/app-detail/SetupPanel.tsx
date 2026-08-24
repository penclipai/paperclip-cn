import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ToolCatalogEntry, ToolConnection } from "@penclipai/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { appDefinitionSlug } from "../app-definition-display";
import type { AppDetailSectionProps } from "./types";
import { googleSheetsConfigWithAllowlist, parseGoogleSheetIds } from "../google-sheets";

export function SetupPanel({
  connection,
  galleryEntry,
  onToggleApp,
  appToggleDisabled,
  onUpdateConfig,
  configUpdateDisabled,
  onStartOAuth,
  oauthStartDisabled,
}: Pick<
  AppDetailSectionProps,
  "connection" | "galleryEntry"
> & {
  onToggleApp: () => void;
  appToggleDisabled: boolean;
  onUpdateConfig: (config: Record<string, unknown>) => void;
  configUpdateDisabled: boolean;
  onStartOAuth: () => void;
  oauthStartDisabled: boolean;
}) {
  const { t } = useTranslation();
  const description = galleryEntry?.description ?? null;
  const oauth = connection.config?.oauth;
  const hasOAuthSignIn = Boolean(oauth && typeof oauth === "object" && !Array.isArray(oauth));
  const isSmokeLabFixture = connection.config?.smokeLabFixture === "oauth-http";
  return (
    <div className="space-y-6">
      {description && (
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{description}</p>
      )}
      {appDefinitionSlug(galleryEntry) === "google-sheets" && (
        <GoogleSheetsAllowlistSection
          connection={connection}
          disabled={configUpdateDisabled}
          onUpdateConfig={onUpdateConfig}
        />
      )}
      {hasOAuthSignIn && (
        <OAuthConnectionSection
          connected={Boolean((oauth as Record<string, unknown>).connectedAt)}
          appName={galleryEntry?.name ?? providerNameFor(appDefinitionSlug(galleryEntry), isSmokeLabFixture)}
          providerName={appDefinitionSlug(galleryEntry) === "notion" ? "Notion" : isSmokeLabFixture ? "Smoke OAuth" : "OAuth"}
          disabled={oauthStartDisabled}
          onStart={onStartOAuth}
        />
      )}
      <AppLifecycleSection connection={connection} disabled={appToggleDisabled} onToggle={onToggleApp} />
    </div>
  );
}

function providerNameFor(slug: string | undefined, isSmokeLabFixture: boolean): string {
  if (slug === "notion") return "Notion";
  if (isSmokeLabFixture) return "Smoke OAuth";
  return "OAuth";
}

function OAuthConnectionSection({
  connected,
  appName,
  providerName,
  disabled,
  onStart,
}: {
  connected: boolean;
  appName: string;
  providerName: string;
  disabled: boolean;
  onStart: () => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {connected
              ? t("apps.detail.setup.oauth.connectedTitle", {
                  defaultValue: "Connected with {{providerName}}",
                  providerName,
                })
              : t("apps.detail.setup.oauth.connectTitle", {
                  defaultValue: "Connect with {{providerName}}",
                  providerName,
                })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {connected
              ? t("apps.detail.setup.oauth.connectedDescription", {
                  defaultValue: "Sign in again to replace this connection's OAuth session.",
                })
              : t("apps.detail.setup.oauth.connectDescription", {
                  defaultValue: "Open the provider's consent page to finish connecting {{appName}}.",
                  appName,
                })}
          </p>
        </div>
        <Button type="button" disabled={disabled} onClick={onStart}>
          {connected
            ? t("apps.detail.setup.oauth.reconnect", { defaultValue: "Reconnect" })
            : t("apps.detail.setup.oauth.connectButton", {
                defaultValue: "Connect with {{providerName}}",
                providerName,
              })}
        </Button>
      </div>
    </section>
  );
}

function currentSpreadsheetIds(connection: ToolConnection): string[] {
  const raw = connection.config?.allowedSpreadsheetIds;
  return Array.isArray(raw) ? raw.map((value) => String(value).trim()).filter(Boolean) : [];
}

function googleSheetsUrlForId(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit`;
}

function GoogleSheetsAllowlistSection({
  connection,
  disabled,
  onUpdateConfig,
}: {
  connection: ToolConnection;
  disabled: boolean;
  onUpdateConfig: (config: Record<string, unknown>) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const ids = currentSpreadsheetIds(connection);
  const saveIds = (nextIds: string[]) =>
    onUpdateConfig(googleSheetsConfigWithAllowlist(connection.config, nextIds));

  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div>
        <h2 className="text-sm font-bold text-foreground">
          {t("apps.detail.setup.googleSheets.title", { defaultValue: "Sheets agents can use" })}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {t("apps.detail.setup.googleSheets.description", {
            defaultValue: "Agents can only use the sheets listed here.",
          })}
        </p>
      </div>

      <div className="mt-4 space-y-2">
        {ids.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            {t("apps.detail.setup.googleSheets.empty", { defaultValue: "No sheets are connected yet." })}
          </div>
        ) : (
          ids.map((id) => {
            const sheetUrl = googleSheetsUrlForId(id);
            return (
              <div key={id} className="flex items-center gap-3 border-t border-border py-2 first:border-t-0">
                <a
                  href={sheetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                >
                  <span className="block truncate">
                    {t("apps.detail.setup.googleSheets.openSheet", { defaultValue: "Open sheet" })}
                  </span>
                  <span className="block truncate font-mono text-xs font-normal text-muted-foreground">
                    {sheetUrl}
                  </span>
                  <span className="block truncate font-mono text-(length:--text-micro) font-normal text-muted-foreground/80">
                    {t("apps.setup.id", { defaultValue: "ID:" })} {id}
                  </span>
                </a>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={disabled || ids.length <= 1}
                  title={ids.length <= 1
                    ? t("apps.detail.setup.googleSheets.removeDisabledTitle", {
                        defaultValue: "Add another sheet before removing this one.",
                      })
                    : undefined}
                  onClick={() => saveIds(ids.filter((current) => current !== id))}
                >
                  {t("tools.common.remove", { defaultValue: "Remove" })}
                </Button>
              </div>
            );
          })
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Input
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setError(null);
          }}
          placeholder={t("apps.detail.setup.googleSheets.placeholder", {
            defaultValue: "https://docs.google.com/spreadsheets/d/...",
          })}
          className="h-10"
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            const parsed = parseGoogleSheetIds(draft);
            if (parsed.ids.length === 0) {
              setError(t("apps.detail.setup.googleSheets.error.missingLink", {
                defaultValue: "Paste a Google Sheets link.",
              }));
              return;
            }
            if (parsed.invalidCount > 0) {
              setError(t("apps.detail.setup.googleSheets.error.invalidLink", {
                defaultValue: "That doesn't look like a Google Sheets link.",
              }));
              return;
            }
            saveIds(Array.from(new Set([...ids, ...parsed.ids])));
            setDraft("");
          }}
        >
          {t("apps.detail.setup.googleSheets.addSheet", { defaultValue: "Add sheet" })}
        </Button>
      </div>
      {error && <div className="mt-2 text-xs text-destructive">{error}</div>}
    </section>
  );
}

export function AppLifecycleSection({
  connection,
  disabled,
  onToggle,
}: {
  connection: ToolConnection;
  disabled: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const enabled = connection.enabled !== false && connection.status !== "disabled";
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-sm font-bold text-foreground">
            {enabled
              ? t("apps.detail.setup.lifecycle.enabledTitle", { defaultValue: "Agents can use this app" })
              : t("apps.detail.setup.lifecycle.pausedTitle", { defaultValue: "This app is paused" })}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {enabled
              ? t("apps.detail.setup.lifecycle.enabledDescription", {
                  defaultValue: "Pause it to stop every agent from using its actions.",
                })
              : t("apps.detail.setup.lifecycle.pausedDescription", {
                  defaultValue: "Resume it when agents should be able to use its actions again.",
                })}
          </p>
        </div>
        <ToggleSwitch
          aria-label={enabled
            ? t("apps.detail.setup.lifecycle.pauseAria", { defaultValue: "Pause this app" })
            : t("apps.detail.setup.lifecycle.resumeAria", { defaultValue: "Resume this app" })}
          checked={enabled}
          disabled={disabled}
          onCheckedChange={onToggle}
          size="lg"
        />
      </div>
    </section>
  );
}

export function QuarantinedActionsReview({
  entries,
  disabled,
  onSubmit,
}: {
  entries: ToolCatalogEntry[];
  disabled: boolean;
  onSubmit: (enabledIds: string[]) => void;
}) {
  const { t } = useTranslation();
  const [enabledIds, setEnabledIds] = useState<Set<string>>(new Set());
  const count = entries.length;
  const selectedIds = entries.filter((entry) => enabledIds.has(entry.id)).map((entry) => entry.id);
  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/40 bg-amber-500/[0.08]">
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-amber-800 dark:text-amber-200">
            {t("apps.detail.setup.quarantine.title", {
              count,
              defaultValue: "{{count}} new actions to review",
            })}
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
            {t("apps.detail.setup.quarantine.description", {
              defaultValue: "This app added actions since you set it up. They stay off until you turn them on.",
            })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set(entries.map((entry) => entry.id)))}
          >
            {t("apps.detail.setup.quarantine.turnOnAll", { defaultValue: "Turn on all" })}
          </button>
          <button
            type="button"
            className="text-xs font-medium text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
            disabled={disabled}
            onClick={() => setEnabledIds(new Set())}
          >
            {t("apps.connect.actions.turnAllOff", { defaultValue: "Turn all off" })}
          </button>
        </div>
      </div>
      <div className="divide-y divide-amber-500/25 border-y border-amber-500/25 bg-background">
        {entries.map((entry) => {
          const enabled = enabledIds.has(entry.id);
          const label = entry.title ?? entry.toolName;
          return (
            <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">{label}</div>
                {entry.description && (
                  <div className="truncate text-xs text-muted-foreground">{entry.description}</div>
                )}
              </div>
              <ToggleSwitch
                aria-label={`${label} allowed`}
                checked={enabled}
                disabled={disabled}
                onCheckedChange={(next) => {
                  setEnabledIds((current) => {
                    const updated = new Set(current);
                    if (next) updated.add(entry.id);
                    else updated.delete(entry.id);
                    return updated;
                  });
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="text-xs text-amber-700 dark:text-amber-300">
          {t("apps.connect.actions.continueCount", {
            count: selectedIds.length,
            defaultValue: "Continue with {{count}} actions on",
          })}
        </span>
        <Button size="sm" disabled={disabled} onClick={() => onSubmit(selectedIds)}>
          {disabled
            ? t("apps.detail.common.savingEllipsis", { defaultValue: "Saving…" })
            : t("apps.detail.common.saveChoices", { defaultValue: "Save choices" })}
        </Button>
      </div>
    </section>
  );
}
