import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ToolConnection } from "@penclipai/shared";
import {
  connectionDisplaySecondaryHint,
  humanizeConnectionDisplayName,
  isToolConnectionAttentionHealth,
} from "@penclipai/shared";
import { Navigate, useNavigate, useParams } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { useToast } from "@/context/ToastContext";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { toolsApi } from "@/api/tools";
import { agentsApi } from "@/api/agents";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AppLogo } from "./AppLogo";
import {
  appApplicationSourceSlug,
  appDefinitionLogoUrl,
  appDefinitionName,
  appDefinitionSlug,
  type AppGalleryDisplayEntry,
} from "./app-definition-display";
import { isMcpDirectOAuthConnectSlug } from "./app-connect-policy";
import { connectionAddress, connectionTransportLabel, DangerZone } from "./AppDetail";
import { ActivityPanel } from "./app-detail/ActivityPanel";
import { ReviewPanel } from "./app-detail/ReviewPanel";
import { appApplicationTabHref, appTabHref, appTabTranslationKey, isAppTabKey, type AppTabKey } from "./app-tabs";

export function AppNotConnected() {
  const { t } = useTranslation();
  const { applicationId = "", tab } = useParams<{ applicationId: string; tab?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const activeTab: AppTabKey | null = isAppTabKey(tab) ? tab : null;

  const applicationsQuery = useQuery({
    queryKey: queryKeys.tools.applications(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listApplications(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!activeTab,
  });
  const connectionsQuery = useQuery({
    queryKey: queryKeys.tools.connections(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listConnections(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!activeTab,
  });
  const galleryQuery = useQuery({
    queryKey: queryKeys.apps.gallery(selectedCompanyId ?? "__none__"),
    queryFn: () => toolsApi.listGallery(selectedCompanyId!),
    enabled: !!selectedCompanyId && !!activeTab,
  });

  const application = useMemo(
    () => (applicationsQuery.data?.applications ?? []).find((app) => app.id === applicationId),
    [applicationsQuery.data, applicationId],
  );
  const appSourceSlug = appApplicationSourceSlug(application);
  const relatedApplicationIds = useMemo(() => {
    if (!application) return new Set<string>();
    if (!appSourceSlug) return new Set([application.id]);
    return new Set(
      (applicationsQuery.data?.applications ?? [])
        .filter((candidate) => appApplicationSourceSlug(candidate) === appSourceSlug)
        .map((candidate) => candidate.id),
    );
  }, [application, applicationsQuery.data, appSourceSlug]);
  const appConnections = useMemo(
    () => (connectionsQuery.data?.connections ?? []).filter((c) => relatedApplicationIds.has(c.applicationId)),
    [connectionsQuery.data, relatedApplicationIds],
  );
  const activeConnections = useMemo(
    () => appConnections.filter((c) => c.status !== "archived" && c.status !== "draft"),
    [appConnections],
  );
  const activeConnection = activeConnections[0] ?? null;
  const previousConnection = useMemo(() => latestArchivedConnection(appConnections), [appConnections]);
  const activityQuery = useQuery({
    queryKey: queryKeys.tools.connectionActivity(previousConnection?.id ?? "__none__"),
    queryFn: () => toolsApi.listConnectionActivity(previousConnection!.id, 20),
    enabled: !!previousConnection && activeTab === "activity",
  });
  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId ?? "__none__"),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId && activeTab === "activity",
  });

  const appName = application?.name ?? "App";
  useEffect(() => {
    if (!activeTab) return;
    setBreadcrumbs([
      { label: selectedCompany?.name ?? t("apps.detail.breadcrumb.company", { defaultValue: "Company" }), href: "/dashboard" },
      { label: t("apps.detail.breadcrumb.apps", { defaultValue: "Apps" }), href: "/apps" },
      { label: appName, href: appApplicationTabHref(applicationId, "setup") },
      { label: t(appTabTranslationKey(activeTab), { defaultValue: activeTab }) },
    ]);
    return () => setBreadcrumbs([]);
  }, [setBreadcrumbs, selectedCompany?.name, appName, applicationId, activeTab, t]);

  const remove = useMutation({
    mutationFn: () => toolsApi.updateApplication(applicationId, { status: "archived" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tools.applications(selectedCompanyId ?? "__none__") });
      pushToast({
        title: t("apps.notConnected.removedToast.title", { defaultValue: "App removed" }),
        body: t("apps.notConnected.removedToast.body", {
          appName,
          defaultValue: "{{appName}} no longer shows in your apps. You can connect it again any time.",
        }),
        tone: "success",
      });
      navigate("/apps/connections");
    },
    onError: (error) => {
      pushToast({
        title: t("apps.notConnected.removeError.title", { defaultValue: "Couldn’t remove the app" }),
        body: error instanceof Error ? error.message : t("apps.common.tryAgain", { defaultValue: "Please try again." }),
        tone: "error",
      });
    },
  });

  if (!selectedCompanyId) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {t("apps.notConnected.selectCompany", { defaultValue: "Select a company to manage apps." })}
      </div>
    );
  }
  if (!applicationId || !activeTab) {
    return <Navigate to={applicationId ? appApplicationTabHref(applicationId, "setup") : "/apps/connections"} replace />;
  }
  if (applicationsQuery.isLoading || connectionsQuery.isLoading) {
    return (
      <div className="max-w-3xl space-y-3">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!application) {
    return (
      <div className="max-w-3xl space-y-3 p-6 text-sm text-muted-foreground">
        <p>{t("apps.notConnected.notFound", { defaultValue: "This app doesn’t exist anymore." })}</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/apps/connections")}>
          {t("apps.common.backToApps", { defaultValue: "Back to apps" })}
        </Button>
      </div>
    );
  }
  if (activeConnection && activeTab !== "setup") {
    return <Navigate to={appTabHref(activeConnection.id, activeTab)} replace />;
  }

  const gallery = (galleryQuery.data?.apps ?? []) as AppGalleryDisplayEntry[];
  const logoUrl =
    (appSourceSlug
      ? appDefinitionLogoUrl(gallery.find((entry) => appDefinitionSlug(entry) === appSourceSlug))
      : undefined) ??
    appDefinitionLogoUrl(
      gallery.find((entry) => appDefinitionName(entry).toLowerCase() === application.name.toLowerCase()),
    );

  const previousAddress = previousConnection ? connectionAddress(previousConnection) : null;
  const connectHref = newConnectionHref({
    applicationId,
    appName: application.name,
    previousAddress,
    sourceSlug: appSourceSlug,
  });

  return (
    <div className="max-w-3xl space-y-6 pb-12">
      <ApplicationHeader
        applicationName={application.name}
        description={application.description}
        logoUrl={logoUrl}
        connectedCount={activeConnections.length}
      />

      {activeTab === "setup" && (
        <SetupTab
          applicationName={application.name}
          activeConnections={activeConnections}
          previousConnection={previousConnection}
          previousAddress={previousAddress}
          onConnect={() => navigate(connectHref)}
          onEdit={(connectionId) => navigate(appTabHref(connectionId, "setup"))}
        />
      )}
      {activeTab === "review" && (
        previousConnection ? (
          <ReviewPanel connectionId={previousConnection.id} />
        ) : (
          <EmptyTab
            title={t("apps.review.empty", { defaultValue: "Nothing is waiting for your OK right now." })}
            body={t("apps.notConnected.reviewAfterConnect", {
              defaultValue: "Review requests will appear here after this app is connected.",
            })}
          />
        )
      )}
      {activeTab === "permissions" && (
        <PermissionsTab previousConnection={previousConnection} />
      )}
      {activeTab === "test" && (
        <EmptyTab
          title={t("apps.notConnected.testTitle", { defaultValue: "Reconnect to test this app." })}
          body={t("apps.notConnected.testBody", {
            defaultValue: "Testing becomes available after this app is connected again.",
          })}
        />
      )}
      {activeTab === "activity" && (
        previousConnection ? (
          <ActivityPanel
            events={activityQuery.data?.events ?? []}
            lifecycleEvents={activityQuery.data?.lifecycleEvents ?? []}
            issues={activityQuery.data?.issues ?? {}}
            actionRequests={activityQuery.data?.actionRequests ?? {}}
            loading={activityQuery.isLoading}
            agents={agentsQuery.data ?? []}
            connectionId={previousConnection.id}
            appName={appName}
          />
        ) : (
          <ActivityPanel
            events={[]}
            lifecycleEvents={[]}
            issues={{}}
            actionRequests={{}}
            loading={false}
            agents={[]}
            connectionId=""
            appName={appName}
          />
        )
      )}
      {activeTab === "advanced" && (
        <AdvancedTab
          appName={application.name}
          previousConnection={previousConnection}
          previousAddress={previousAddress}
          removing={remove.isPending}
          onRemove={() => remove.mutate()}
        />
      )}
    </div>
  );
}

function ApplicationHeader({
  applicationName,
  description,
  logoUrl,
  connectedCount,
}: {
  applicationName: string;
  description: string | null;
  logoUrl: string | undefined;
  connectedCount: number;
}) {
  const { t } = useTranslation();
  return (
    <header className="flex flex-wrap items-center gap-4">
      <AppLogo name={applicationName} logoUrl={logoUrl} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-2xl font-bold tracking-tight">{applicationName}</h1>
          <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {connectedCount > 0
              ? t("apps.notConnected.connectionCount", {
                count: connectedCount,
                defaultValue: "{{count}} connected",
              })
              : t("apps.notConnected.notConnected", { defaultValue: "Not connected" })}
          </span>
        </div>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
    </header>
  );
}

function SetupTab({
  applicationName,
  activeConnections,
  previousConnection,
  previousAddress,
  onConnect,
  onEdit,
}: {
  applicationName: string;
  activeConnections: ToolConnection[];
  previousConnection: ToolConnection | null;
  previousAddress: string | null;
  onConnect: () => void;
  onEdit: (connectionId: string) => void;
}) {
  const { t } = useTranslation();
  if (activeConnections.length > 0) {
    return (
      <div className="space-y-6">
        <section className="space-y-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {t("apps.notConnected.alreadyConnected", {
                appName: applicationName,
                defaultValue: "Already connected to {{appName}}",
              })}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t("apps.notConnected.manageConnections", {
                defaultValue: "Open a connection to edit it, or add another account.",
              })}
            </p>
          </div>
          <div className="overflow-hidden rounded-lg border border-border">
            {activeConnections.map((connection) => {
              const addressHint = connectionDisplaySecondaryHint(connection);
              const secondary = addressHint
                ? t("apps.notConnected.hostedAt", {
                  address: addressHint.replace(/^hosted at\s+/i, ""),
                  defaultValue: "Hosted at {{address}}",
                })
                : connection.lastUsedAt
                  ? t("apps.notConnected.lastUsedAt", {
                    time: timeAgo(connection.lastUsedAt),
                    defaultValue: "Last used {{time}}",
                  })
                  : t("apps.notConnected.notUsedYet", { defaultValue: "Not used yet" });
              const status = connection.enabled === false || connection.status === "disabled"
                ? t("apps.notConnected.status.paused", { defaultValue: "Paused" })
                : isToolConnectionAttentionHealth(connection.healthStatus)
                  ? t("apps.notConnected.status.needsAttention", { defaultValue: "Needs attention" })
                  : t("apps.notConnected.status.connected", { defaultValue: "Connected" });
              return (
                <button
                  key={connection.id}
                  type="button"
                  onClick={() => onEdit(connection.id)}
                  className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-foreground">
                      {humanizeConnectionDisplayName(connection)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{secondary}</div>
                  </div>
                  <span className="text-xs text-muted-foreground">{status}</span>
                  <span className="text-xs font-semibold text-primary">
                    {t("apps.notConnected.edit", { defaultValue: "Edit →" })}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {t("apps.notConnected.connectAnother", { defaultValue: "Connect another" })}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {t("apps.notConnected.connectAnotherDescription", {
                  appName: applicationName,
                  defaultValue: "Add another {{appName}} account without changing the connections above.",
                })}
              </p>
            </div>
            <Button onClick={onConnect}>
              {t("apps.notConnected.connectAnother", { defaultValue: "Connect another" })}
            </Button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-foreground">
              {previousConnection
                ? t("apps.notConnected.reconnectTitle", { defaultValue: "Reconnect this app" })
                : t("apps.notConnected.connectTitle", { defaultValue: "Connect this app" })}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {previousConnection
                ? t("apps.notConnected.reconnectDescription", {
                  defaultValue: "We kept the previous setup. Add a working key to bring it back online.",
                })
                : t("apps.notConnected.connectDescription", {
                  defaultValue: "Agents can't use it until it's connected.",
                })}
            </p>
          </div>
          <Button onClick={onConnect}>
            {previousConnection
              ? t("apps.notConnected.reconnect", { defaultValue: "Reconnect" })
              : t("apps.notConnected.connect", { defaultValue: "Connect" })}
          </Button>
        </div>
      </section>

      {previousConnection && (
        <PreviousSetup connection={previousConnection} previousAddress={previousAddress} />
      )}
    </div>
  );
}

function PreviousSetup({
  connection,
  previousAddress,
}: {
  connection: ToolConnection;
  previousAddress: string | null;
}) {
  const { t } = useTranslation();
  const transportKey = connection.transport === "mcp_remote"
    ? "apps.detail.advanced.technical.transport.remoteHttp"
    : connection.transport === "local_stdio"
      ? "apps.detail.advanced.technical.transport.localCommand"
      : "apps.detail.advanced.technical.transport.unknown";
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="text-sm font-bold text-foreground">
        {t("apps.notConnected.previousSetup", { defaultValue: "Previous setup" })}
      </h2>
      {connection.healthMessage && (
        <p className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          {t("apps.notConnected.lastError", { defaultValue: "Last error:" })} {connection.healthMessage}
        </p>
      )}
      <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-(--gtc-59)">
        <dt className="text-muted-foreground">
          {t("apps.notConnected.address", { defaultValue: "Address" })}
        </dt>
        <dd className="break-all font-mono text-foreground">{previousAddress}</dd>
        <dt className="text-muted-foreground">
          {t("apps.notConnected.connectionType", { defaultValue: "Connection type" })}
        </dt>
        <dd className="text-foreground">
          {t(transportKey, { defaultValue: connectionTransportLabel(connection.transport) })}
        </dd>
        <dt className="text-muted-foreground">
          {t("apps.notConnected.lastUsed", { defaultValue: "Last used" })}
        </dt>
        <dd className="text-foreground">
          {connection.lastUsedAt
            ? timeAgo(connection.lastUsedAt)
            : t("apps.notConnected.never", { defaultValue: "Never" })}
        </dd>
      </dl>
    </section>
  );
}

function PermissionsTab({ previousConnection }: { previousConnection: ToolConnection | null }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="text-sm font-bold text-foreground">
        {t("apps.notConnected.permissionsPaused", { defaultValue: "Permissions paused" })}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("apps.notConnected.permissionsDescription", {
          defaultValue: "Reconnect this app to edit who can use it and which actions need a human first.",
        })}
      </p>
      {previousConnection && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t("apps.notConnected.permissionsReadOnly", {
            defaultValue: "Previous setup is retained for reconnect, but access controls stay read-only until the app is online.",
          })}
        </p>
      )}
    </section>
  );
}

function AdvancedTab({
  appName,
  previousConnection,
  previousAddress,
  removing,
  onRemove,
}: {
  appName: string;
  previousConnection: ToolConnection | null;
  previousAddress: string | null;
  removing: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-6">
      {previousConnection ? (
        <PreviousSetup connection={previousConnection} previousAddress={previousAddress} />
      ) : (
        <EmptyTab
          title={t("apps.notConnected.noPreviousDetails", { defaultValue: "No previous connection details" })}
          body={t("apps.notConnected.detailsAfterConnect", {
            defaultValue: "Technical details will appear here after this app is connected.",
          })}
        />
      )}
      <DangerZone appName={appName} removing={removing} onRemove={onRemove} />
    </div>
  );
}

function EmptyTab({ title, body }: { title: string; body: string }) {
  return (
    <section className="rounded-xl border border-border bg-card px-5 py-4">
      <h2 className="text-sm font-bold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </section>
  );
}

function latestArchivedConnection(connections: ToolConnection[]): ToolConnection | null {
  const archived = connections.filter((c) => c.status === "archived");
  if (archived.length === 0) return null;
  return archived.reduce((latest, connection) => {
    const latestTime = new Date(latest.updatedAt ?? latest.createdAt ?? 0).getTime();
    const connectionTime = new Date(connection.updatedAt ?? connection.createdAt ?? 0).getTime();
    return connectionTime > latestTime ? connection : latest;
  });
}

function newConnectionHref({
  applicationId,
  appName,
  previousAddress,
  sourceSlug,
}: {
  applicationId: string;
  appName: string;
  previousAddress: string | null;
  sourceSlug: string | null;
}): string {
  const params = new URLSearchParams({ applicationId, name: appName, new: "1" });
  if (sourceSlug) params.set("source", sourceSlug);
  if (!isMcpDirectOAuthConnectSlug(sourceSlug)) params.set("byo", "1");
  if (previousAddress && /^https?:\/\//i.test(previousAddress)) params.set("link", previousAddress);
  return `/apps/connect?${params.toString()}`;
}
