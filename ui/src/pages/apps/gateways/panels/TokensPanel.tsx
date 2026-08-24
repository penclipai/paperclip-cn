import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import type {
  ToolMcpGatewayTokenAction,
  ToolMcpGatewayTokenCreated,
  ToolMcpGatewayWithTokens,
} from "@penclipai/shared";
import { toolsApi } from "@/api/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/context/ToastContext";
import { RelativeTime } from "@/pages/tools/shared";
import { cn } from "@/lib/utils";
import { copyTextToClipboard } from "@/lib/clipboard";
import { gatewaysQueryKey } from "../NewGatewayDialog";
import { maskedTokenLabel, TOKEN_STATUS_LABEL, tokenStatus, type TokenStatus } from "../gateway-helpers";

const DEFAULT_ACTIONS: ToolMcpGatewayTokenAction[] = ["tools/list", "tools/call"];

function defaultExpiry(): string {
  return new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const STATUS_CLASS: Record<TokenStatus, string> = {
  active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  expiring: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  expired: "border-border bg-muted text-muted-foreground",
  revoked: "border-foreground bg-foreground text-background",
};

/** Token status pill, shared by the desktop table and mobile cards. */
function StatusBadge({ status }: { status: TokenStatus }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      {TOKEN_STATUS_LABEL[status]}
    </span>
  );
}

/** One label:value pair inside a mobile stacked card. */
function TokenField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 truncate text-foreground">{value}</dd>
    </div>
  );
}

export function TokensPanel({
  companyId,
  gateway,
  onTokenCreated,
}: {
  companyId: string;
  gateway: ToolMcpGatewayWithTokens;
  onTokenCreated?: (token: ToolMcpGatewayTokenCreated) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const [minting, setMinting] = useState(false);
  const [name, setName] = useState("");
  const [clientLabel, setClientLabel] = useState("");
  const [ownerNote, setOwnerNote] = useState("");
  const [expiresAt, setExpiresAt] = useState(defaultExpiry());
  const [created, setCreated] = useState<ToolMcpGatewayTokenCreated | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [revokeName, setRevokeName] = useState("");
  const [confirmToken, setConfirmToken] = useState<{ id: string; name: string } | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: gatewaysQueryKey(companyId) });

  const createMutation = useMutation({
    mutationFn: () =>
      toolsApi.createGatewayToken(companyId, gateway.id, {
        name: name.trim(),
        clientLabel: clientLabel.trim() || name.trim(),
        ownerNote: ownerNote.trim() || name.trim(),
        allowedActions: DEFAULT_ACTIONS,
        expiresAt: expiresAt ? `${expiresAt}T23:59:59.000Z` : null,
      }),
    onSuccess: async (token) => {
      setCreated(token);
      setRevealed(true);
      setMinting(false);
      setName("");
      setClientLabel("");
      setOwnerNote("");
      setExpiresAt(defaultExpiry());
      pushToast({
        title: t("apps.gateways.tokens.toast.mintedTitle", { defaultValue: "Token minted" }),
        body: t("apps.gateways.tokens.toast.mintedBody", {
          defaultValue: "Copy it now — you won’t see the full value again.",
        }),
        tone: "success",
      });
      onTokenCreated?.(token);
      await invalidate();
    },
    onError: (error) =>
      pushToast({
        title: t("apps.gateways.tokens.toast.mintFailedTitle", { defaultValue: "Token was not minted" }),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      }),
  });

  const revokeMutation = useMutation({
    mutationFn: (tokenId: string) => toolsApi.revokeGatewayToken(companyId, tokenId),
    onSuccess: async (token) => {
      setConfirmToken(null);
      setRevokeName("");
      pushToast({
        title: t("apps.gateways.tokens.toast.revokedTitle", { defaultValue: "Token revoked" }),
        body: t("apps.gateways.tokens.toast.revokedBody", {
          name: token.name,
          defaultValue: "{{name}} can no longer connect.",
        }),
        tone: "success",
      });
      await invalidate();
    },
    onError: (error) =>
      pushToast({
        title: t("apps.gateways.tokens.toast.revokeFailedTitle", { defaultValue: "Token was not revoked" }),
        body: error instanceof Error ? error.message : String(error),
        tone: "error",
      }),
  });

  async function copyToken(value: string) {
    try {
      await copyTextToClipboard(value);
      pushToast({
        title: t("apps.gateways.tokens.toast.copiedTitle", { defaultValue: "Copied" }),
        body: t("apps.gateways.tokens.accessToken", { defaultValue: "Access token" }),
        tone: "success",
      });
    } catch (error) {
      pushToast({
        title: t("apps.gateways.tokens.toast.copyFailedTitle", { defaultValue: "Copy failed" }),
        body: error instanceof Error
          ? error.message
          : t("apps.gateways.tokens.clipboardUnavailable", {
              defaultValue: "Clipboard access is unavailable.",
            }),
        tone: "error",
      });
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim()) return;
    createMutation.mutate();
  }

  const tokens = useMemo(
    () =>
      [...gateway.tokens].sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [gateway.tokens],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {t("apps.gateways.tokens.description", {
            defaultValue: "Each token is a separate way in. Revoke any one without breaking the others.",
          })}
        </p>
        <Button size="sm" onClick={() => setMinting((value) => !value)}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          {t("apps.gateways.tokens.mintToken", { defaultValue: "Mint token" })}
        </Button>
      </div>

      {minting ? (
        <form className="space-y-3 rounded-md border border-border p-4" onSubmit={submit}>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t("apps.gateways.tokens.nameLabel", { defaultValue: "Name" })}
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("apps.gateways.tokens.namePlaceholder", { defaultValue: "cto-cursor" })}
                required
                autoFocus
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t("apps.gateways.tokens.ownerClientLabel", { defaultValue: "Owner / client" })}
              </span>
              <Input
                value={clientLabel}
                onChange={(e) => setClientLabel(e.target.value)}
                placeholder={t("apps.gateways.tokens.ownerClientPlaceholder", {
                  defaultValue: "Cursor on work laptop",
                })}
              />
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t("apps.gateways.tokens.noteLabel", { defaultValue: "Note (why it exists)" })}
              </span>
              <Input
                value={ownerNote}
                onChange={(e) => setOwnerNote(e.target.value)}
                placeholder={t("apps.gateways.tokens.notePlaceholder", { defaultValue: "Dotta’s MacBook" })}
              />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                {t("apps.gateways.tokens.expiresLabel", { defaultValue: "Expires" })}
              </span>
              <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} required />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setMinting(false)}>
              {t("apps.gateways.tokens.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending
                ? t("apps.gateways.tokens.minting", { defaultValue: "Minting…" })
                : t("apps.gateways.tokens.mintToken", { defaultValue: "Mint token" })}
            </Button>
          </div>
        </form>
      ) : null}

      {created ? (
        <div className="space-y-2 rounded-md border-2 border-foreground/80 bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-foreground">
                {t("apps.gateways.tokens.newTokenTitle", { defaultValue: "New token — copy now" })}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("apps.gateways.tokens.newTokenBody", {
                  defaultValue: "You won’t see the full value again. Store it in your client’s config or your secret manager.",
                })}
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCreated(null)}
              aria-label={t("apps.gateways.tokens.dismissNewTokenAriaLabel", {
                defaultValue: "Dismiss new token",
              })}
            >
              {t("apps.gateways.tokens.dismiss", { defaultValue: "Dismiss" })}
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-background px-3 py-2 font-mono text-xs text-foreground">
              {revealed ? created.token : maskedTokenLabel(created)}
            </code>
            {revealed ? (
              <Button variant="outline" size="sm" onClick={() => void copyToken(created.token)}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                {t("apps.gateways.tokens.copy", { defaultValue: "Copy" })}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setRevealed(true)}>
                {t("apps.gateways.tokens.show", { defaultValue: "Show" })}
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {tokens.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          {t("apps.gateways.tokens.empty", {
            defaultValue: "No tokens yet. Mint one for the client that will connect to this gateway.",
          })}
        </div>
      ) : (
        <>
          {/* Desktop / tablet: full table. */}
          <div className="hidden overflow-x-auto rounded-lg border border-border sm:block">
            <table className="w-full min-w-(--sz-44rem) text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-left text-(length:--text-micro) font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.token", { defaultValue: "Token" })}</th>
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.owner", { defaultValue: "Owner" })}</th>
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.created", { defaultValue: "Created" })}</th>
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.lastUsed", { defaultValue: "Last used" })}</th>
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.expires", { defaultValue: "Expires" })}</th>
                  <th className="px-4 py-2.5">{t("apps.gateways.tokens.table.status", { defaultValue: "Status" })}</th>
                  <th className="px-4 py-2.5 text-right" />
                </tr>
              </thead>
              <tbody>
                {tokens.map((token) => {
                  const status = tokenStatus(token);
                  const canRevoke = status !== "revoked";
                  return (
                    <tr key={token.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{token.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{maskedTokenLabel(token)}</div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{token.clientLabel || token.ownerNote || "—"}</td>
                      <td className="px-4 py-3 text-muted-foreground"><RelativeTime value={token.createdAt} /></td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {token.lastUsedAt ? <RelativeTime value={token.lastUsedAt} /> : "—"}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {token.revokedAt ? "—" : token.expiresAt ? <RelativeTime value={token.expiresAt} /> : t("apps.gateways.tokens.noExpiry", { defaultValue: "no expiry" })}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canRevoke ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setConfirmToken({ id: token.id, name: token.name });
                              setRevokeName("");
                            }}
                          >
                            {t("apps.gateways.tokens.revoke", { defaultValue: "Revoke" })}
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: stacked cards so status + Revoke stay reachable. */}
          <div className="space-y-3 sm:hidden">
            {tokens.map((token) => {
              const status = tokenStatus(token);
              const canRevoke = status !== "revoked";
              return (
                <div key={token.id} className="rounded-lg border border-border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{token.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">{maskedTokenLabel(token)}</div>
                    </div>
                    <StatusBadge status={status} />
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <TokenField
                      label={t("apps.gateways.tokens.mobile.owner", { defaultValue: "Owner" })}
                      value={token.clientLabel || token.ownerNote || "—"}
                    />
                    <TokenField
                      label={t("apps.gateways.tokens.mobile.created", { defaultValue: "Created" })}
                      value={<RelativeTime value={token.createdAt} />}
                    />
                    <TokenField
                      label={t("apps.gateways.tokens.mobile.lastUsed", { defaultValue: "Last used" })}
                      value={token.lastUsedAt ? <RelativeTime value={token.lastUsedAt} /> : "—"}
                    />
                    <TokenField
                      label={t("apps.gateways.tokens.mobile.expires", { defaultValue: "Expires" })}
                      value={
                        token.revokedAt ? "—" : token.expiresAt ? <RelativeTime value={token.expiresAt} /> : t("apps.gateways.tokens.noExpiry", { defaultValue: "no expiry" })
                      }
                    />
                  </dl>
                  {canRevoke ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-3 w-full text-xs text-destructive hover:text-destructive"
                      onClick={() => {
                        setConfirmToken({ id: token.id, name: token.name });
                        setRevokeName("");
                      }}
                    >
                      {t("apps.gateways.tokens.revoke", { defaultValue: "Revoke" })}
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <KeyRound className="h-3.5 w-3.5" />
        {t("apps.gateways.tokens.activityNote", {
          defaultValue: "Every mint, reveal, and revoke is recorded in Activity.",
        })}
      </p>

      {confirmToken ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-lg border border-border bg-card p-5 shadow-lg">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {t("apps.gateways.tokens.confirmRevokeTitle", { defaultValue: "Revoke this token?" })}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("apps.gateways.tokens.confirmRevokeBodyPrefix", { defaultValue: "Any client using" })}{" "}
                <span className="font-medium text-foreground">{confirmToken.name}</span>{" "}
                {t("apps.gateways.tokens.confirmRevokeBodySuffix", {
                  defaultValue: "goes silent immediately. This can’t be undone. Type the token name to confirm.",
                })}
              </p>
            </div>
            <Input
              value={revokeName}
              onChange={(e) => setRevokeName(e.target.value)}
              placeholder={confirmToken.name}
              aria-label={t("apps.gateways.tokens.confirmRevokeAriaLabel", {
                defaultValue: "Type the token name to confirm",
              })}
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setConfirmToken(null);
                  setRevokeName("");
                }}
              >
                {t("apps.gateways.tokens.cancel", { defaultValue: "Cancel" })}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={revokeName.trim() !== confirmToken.name || revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(confirmToken.id)}
              >
                {revokeMutation.isPending
                  ? t("apps.gateways.tokens.revoking", { defaultValue: "Revoking…" })
                  : t("apps.gateways.tokens.revokeToken", { defaultValue: "Revoke token" })}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
