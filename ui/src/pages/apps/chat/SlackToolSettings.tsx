import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  SlackSearchStatus,
  SlackToolCapabilities,
} from "@penclipai/shared";
import { slackToolsApi } from "@/api/slackTools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SlackCapabilitiesView({
  capabilities,
  error,
}: {
  capabilities?: SlackToolCapabilities;
  error?: string;
}) {
  useTranslation();
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {translateInstant("Read, search, and act in Slack. Some actions require approval.")}</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {!capabilities && !error && (
        <p role="status" className="text-sm text-muted-foreground">
          {translateInstant("Checking Slack permissions…")}</p>
      )}
      {capabilities && (
        <>
          {capabilities.missingScopes.length > 0 && (
            <div className="rounded-lg border border-border bg-muted p-3 space-y-2">
              <p className="text-sm font-medium">
                {translateInstant("Add permissions to unlock more tools")}</p>
              <p className="text-sm">
                {translateInstant("Your existing connection still works. In")}{" "}
                <a
                  className="underline underline-offset-4"
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noreferrer"
                >
                  {translateInstant("Slack app settings")}</a>
                {translateInstant(", choose your app, open OAuth &amp; Permissions, add these Bot Token Scopes, then reinstall the app to your workspace.")}</p>
              <p className="text-xs font-mono break-words">
                {capabilities.missingScopes.join(", ")}
              </p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

export function SlackSearchView({
  status,
  onConnect,
  onDisconnect,
  onConfigure,
}: {
  status: SlackSearchStatus;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
  onConfigure: (input: {
    clientId: string;
    clientSecret: string;
  }) => Promise<void>;
}) {
  useTranslation();
  const id = useId();
  const [clientId, setClientId] = useState(status.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perform = async (action: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to update Slack search",
      );
    } finally {
      setPending(false);
    }
  };
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{translateInstant("Your Slack search access")}</h3>
      <p className="text-sm text-muted-foreground">
        {translateInstant("Optional personal authorization enables private search on supported runtimes. It cannot read channels the bot hasn’t joined or let the bot write as you. Basic channel reading works without it.")}</p>
      {!status.nativeSearchAvailable && (
        <p role="status" className="text-sm text-muted-foreground">
          {status.limitation}
        </p>
      )}
      {status.connected ? (
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm">{translateInstant("Slack search connected")}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => void perform(onDisconnect)}
          >
            {translateInstant("Disconnect search")}</Button>
        </div>
      ) : (
        <Button
          variant="outline"
          disabled={pending || !status.configured}
          onClick={() => void perform(onConnect)}
        >
          {translateInstant("Connect Slack search")}</Button>
      )}
      {!status.configured && (
        <p className="text-sm text-muted-foreground">
          {translateInstant("A connection manager needs to configure your Slack app’s OAuth credentials first.")}</p>
      )}
      {status.canConfigure && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {translateInstant("OAuth app configuration for connection managers")}</summary>
          <form
            className="mt-3 space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void perform(async () => {
                await onConfigure({ clientId, clientSecret });
                setClientSecret("");
              });
            }}
          >
            <p className="text-sm">
              {translateInstant("In Slack app settings, add this redirect URL under OAuth &amp; Permissions. Add user scopes")}<code>search:read.public</code>,{" "}
              <code>search:read.private</code> {translateInstant("and")}{" "}
              <code>search:read.files</code>{translateInstant(". Find Client ID and Client Secret under Basic Information.")}</p>
            <p className="text-xs font-mono break-all">
              {status.redirectUri ?? "Configure a public HTTPS URL first."}
            </p>
            <div className="space-y-2">
              <label htmlFor={`${id}-client`}>{translateInstant("Client ID")}</label>
              <Input
                id={`${id}-client`}
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor={`${id}-secret`}>{translateInstant("Client Secret")}</label>
              <Input
                id={`${id}-secret`}
                type="password"
                autoComplete="new-password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
              />
            </div>
            <div className="flex items-center justify-end gap-3">
              <Button
                type="submit"
                size="sm"
                disabled={pending || !clientId || !clientSecret}
              >
                {translateInstant("Save OAuth configuration")}</Button>
            </div>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
export function SlackToolsSettings({
  companyId,
  endpointId,
  connectionId,
}: {
  companyId: string;
  endpointId: string;
  connectionId?: string | null;
}) {
  useTranslation();
  const query = useQuery({
    queryKey: ["slack-capabilities", companyId, endpointId],
    queryFn: () => slackToolsApi.capabilities(companyId, endpointId),
    staleTime: 60_000,
  });
  return (
    <div className="space-y-3">
      <SlackCapabilitiesView
        capabilities={query.data}
        error={query.error?.message}
      />
      {connectionId && (
        <Link
          className="text-sm underline underline-offset-4"
          to={`/apps/${connectionId}/permissions`}
        >
          {translateInstant("Manage action permissions")}</Link>
      )}
    </div>
  );
}
export function SlackSearchAccess({
  companyId,
  endpointId,
}: {
  companyId: string;
  endpointId: string;
}) {
  useTranslation();
  const query = useQuery({
    queryKey: ["slack-search", companyId, endpointId],
    queryFn: () => slackToolsApi.search(companyId, endpointId),
  });
  if (query.error)
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error.message}
      </p>
    );
  if (!query.data)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {translateInstant("Loading search access…")}</p>
    );
  return (
    <SlackSearchView
      status={query.data}
      onConnect={async () => {
        const result = await slackToolsApi.connect(companyId, endpointId);
        window.location.assign(result.url);
      }}
      onDisconnect={async () => {
        await slackToolsApi.disconnect(companyId, endpointId);
        await query.refetch();
      }}
      onConfigure={async (input) => {
        await slackToolsApi.configure(companyId, endpointId, input);
        await query.refetch();
      }}
    />
  );
}
