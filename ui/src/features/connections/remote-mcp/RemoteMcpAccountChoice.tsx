import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { InlineBanner } from "@/components/InlineBanner";
import { ConnectionChoiceList } from "../ConnectionChoiceList";

/** Shared presentation for account reuse, including the requested external app. */
export function RemoteMcpAccountChoice({
  providerName,
  upstreamServiceName,
  connections,
  pendingId,
  error,
  onSelect,
  onCancel,
  onConnectNew,
}: {
  providerName: string;
  upstreamServiceName?: string;
  connections: { id: string; name: string }[];
  pendingId?: string | null;
  error?: string | null;
  onSelect: (id: string) => void;
  onCancel?: () => void;
  onConnectNew: () => void;
}) {
  useTranslation();
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">
          {upstreamServiceName
            ? translateInstant("connectionUi.accountChoice.connectThrough", { service: upstreamServiceName, provider: providerName })
            : `${translateInstant("Connect")} ${providerName}`}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {translateInstant("Use an existing connection or connect a new account. Existing access stays unchanged.")}
        </p>
      </div>
      {upstreamServiceName && (
        <InlineBanner compact>
          {translateInstant("connectionUi.accountChoice.externalProviderNotice", { provider: providerName, service: upstreamServiceName })}
        </InlineBanner>
      )}
      <ConnectionChoiceList
        choices={connections.map((connection) => ({
          ...connection,
          description: translateInstant("Provider account available"),
        }))}
        pendingId={pendingId}
        onSelect={onSelect}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          disabled={Boolean(pendingId)}
          onClick={onCancel}
        >{translateInstant("Cancel")}</Button>
        <Button disabled={Boolean(pendingId)} onClick={onConnectNew}>
          {translateInstant("Connect new")}
        </Button>
      </div>
    </div>
  );
}
