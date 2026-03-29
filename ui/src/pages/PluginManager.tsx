/**
 * @fileoverview Plugin Manager page — admin UI for discovering,
 * installing, enabling/disabling, and uninstalling plugins.
 *
 * @see PLUGIN_SPEC.md §9 — Plugin Marketplace / Manager
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PluginRecord } from "@penclipai/shared";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { AlertTriangle, FlaskConical, Plus, Power, Puzzle, Settings, Trash } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { pluginsApi } from "@/api/plugins";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useToast } from "@/context/ToastContext";
import { translateRuntimeErrorMessage } from "@/lib/error-i18n";
import { cn } from "@/lib/utils";

function firstNonEmptyLine(value: string | null | undefined): string | null {
  if (!value) return null;
  const line = value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? null;
}

const EXAMPLE_PLUGIN_COPY: Record<
  string,
  {
    description: string;
    descriptionKey: string;
  }
> = {
  "@penclipai/plugin-authoring-smoke-example": {
    description: "用于验证插件宿主与开发流程的冒烟示例插件。",
    descriptionKey: "pluginExamples.authoringSmoke.description",
  },
  "@penclipai/plugin-file-browser-example": {
    description: "示例插件，会在每个项目的侧栏添加“文件”入口，并在项目详情页提供文件浏览与编辑标签页，还支持从评论中的文件链接快速打开引用文件。",
    descriptionKey: "pluginExamples.fileBrowser.description",
  },
  "@penclipai/plugin-hello-world-example": {
    description: "参考界面插件，会在 Penclip 仪表盘中添加一个简单的“你好世界”小组件。",
    descriptionKey: "pluginExamples.helloWorld.description",
  },
  "@penclipai/plugin-kitchen-sink-example": {
    description: "参考插件，在一个示例中集中演示当前 Penclip 插件 API、界面挂载点、桥接动作、事件、任务、Webhook、工具、本地工作区访问和运行诊断能力。",
    descriptionKey: "pluginExamples.kitchenSink.description",
  },
};

function getPluginStatusLabel(status: string, t: ReturnType<typeof useTranslation>["t"]): string {
  switch (status) {
    case "ready":
      return t("Ready", { defaultValue: "Ready" });
    case "error":
      return t("Error", { defaultValue: "Error" });
    case "disabled":
      return t("Disabled", { defaultValue: "Disabled" });
    case "installing":
      return t("Installing", { defaultValue: "Installing" });
    case "installed":
      return t("Installed", { defaultValue: "Installed" });
    default:
      return status;
  }
}

function getLocalizedExampleCopy(
  packageName: string,
  t: ReturnType<typeof useTranslation>["t"],
) {
  const copy = EXAMPLE_PLUGIN_COPY[packageName];
  if (!copy) return null;
  return {
    description: t(copy.descriptionKey, {
      defaultValue: copy.description,
    }),
  };
}

function getPluginDisplayName(
  plugin: Pick<PluginRecord, "packageName" | "manifestJson">,
): string {
  return (
    plugin.manifestJson.displayName
    ?? plugin.packageName
  );
}

function getPluginDescription(
  plugin: Pick<PluginRecord, "packageName" | "manifestJson">,
  t: ReturnType<typeof useTranslation>["t"],
): string | null {
  return (
    getLocalizedExampleCopy(plugin.packageName, t)?.description
    ?? plugin.manifestJson.description
    ?? null
  );
}

function getExampleDisplayName(
  example: { packageName: string; displayName: string },
): string {
  return example.displayName;
}

function getExampleDescription(
  example: { packageName: string; description: string },
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return getLocalizedExampleCopy(example.packageName, t)?.description ?? example.description;
}

function getPluginErrorSummary(
  plugin: PluginRecord,
  t: ReturnType<typeof useTranslation>["t"],
): string {
  return (
    translateRuntimeErrorMessage(t, firstNonEmptyLine(plugin.lastError))
    ?? t("Plugin entered an error state without a stored error message.", {
      defaultValue: "Plugin entered an error state without a stored error message.",
    })
  );
}

/**
 * PluginManager page component.
 *
 * Provides a management UI for the Paperclip plugin system:
 * - Lists all installed plugins with their status, version, and category badges.
 * - Allows installing new plugins by npm package name.
 * - Provides per-plugin actions: enable, disable, navigate to settings.
 * - Uninstall with a two-step confirmation dialog to prevent accidental removal.
 *
 * Data flow:
 * - Reads from `GET /api/plugins` via `pluginsApi.list()`.
 * - Mutations (install / uninstall / enable / disable) invalidate
 *   `queryKeys.plugins.all` so the list refreshes automatically.
 *
 * @see PluginSettings — linked from the Settings icon on each plugin row.
 * @see doc/plugins/PLUGIN_SPEC.md §3 — Plugin Lifecycle for status semantics.
 */
export function PluginManager() {
  const { t } = useTranslation();
  const { selectedCompany } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const { pushToast } = useToast();

  const [installPackage, setInstallPackage] = useState("");
  const [installDialogOpen, setInstallDialogOpen] = useState(false);
  const [uninstallPluginId, setUninstallPluginId] = useState<string | null>(null);
  const [uninstallPluginName, setUninstallPluginName] = useState<string>("");
  const [errorDetailsPlugin, setErrorDetailsPlugin] = useState<PluginRecord | null>(null);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? t("Company"), href: "/dashboard" },
      { label: t("Settings", { defaultValue: "Settings" }), href: "/instance/settings/heartbeats" },
      { label: t("Plugins", { defaultValue: "Plugins" }) },
    ]);
  }, [selectedCompany?.name, setBreadcrumbs, t]);

  const { data: plugins, isLoading, error } = useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => pluginsApi.list(),
  });

  const examplesQuery = useQuery({
    queryKey: queryKeys.plugins.examples,
    queryFn: () => pluginsApi.listExamples(),
  });

  const invalidatePluginQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.examples });
    queryClient.invalidateQueries({ queryKey: queryKeys.plugins.uiContributions });
  };

  const installMutation = useMutation({
    mutationFn: (params: { packageName: string; version?: string; isLocalPath?: boolean }) =>
      pluginsApi.install(params),
    onSuccess: () => {
      invalidatePluginQueries();
      setInstallDialogOpen(false);
      setInstallPackage("");
      pushToast({ title: t("Plugin installed successfully", { defaultValue: "Plugin installed successfully" }), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: t("Failed to install plugin", { defaultValue: "Failed to install plugin" }), body: err.message, tone: "error" });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.uninstall(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: t("Plugin uninstalled successfully", { defaultValue: "Plugin uninstalled successfully" }), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: t("Failed to uninstall plugin", { defaultValue: "Failed to uninstall plugin" }), body: err.message, tone: "error" });
    },
  });

  const enableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.enable(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: t("Plugin enabled", { defaultValue: "Plugin enabled" }), tone: "success" });
    },
    onError: (err: Error) => {
      pushToast({ title: t("Failed to enable plugin", { defaultValue: "Failed to enable plugin" }), body: err.message, tone: "error" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: (pluginId: string) => pluginsApi.disable(pluginId),
    onSuccess: () => {
      invalidatePluginQueries();
      pushToast({ title: t("Plugin disabled", { defaultValue: "Plugin disabled" }), tone: "info" });
    },
    onError: (err: Error) => {
      pushToast({ title: t("Failed to disable plugin", { defaultValue: "Failed to disable plugin" }), body: err.message, tone: "error" });
    },
  });

  const installedPlugins = plugins ?? [];
  const examples = examplesQuery.data ?? [];
  const installedByPackageName = new Map(installedPlugins.map((plugin) => [plugin.packageName, plugin]));
  const examplePackageNames = new Set(examples.map((example) => example.packageName));
  const errorSummaryByPluginId = useMemo(
    () =>
      new Map(
        installedPlugins.map((plugin) => [plugin.id, getPluginErrorSummary(plugin, t)])
      ),
    [installedPlugins, t]
  );

  if (isLoading) return <div className="p-4 text-sm text-muted-foreground">{t("Loading plugins...", { defaultValue: "Loading plugins..." })}</div>;
  if (error) return <div className="p-4 text-sm text-destructive">{t("Failed to load plugins.", { defaultValue: "Failed to load plugins." })}</div>;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Puzzle className="h-6 w-6 text-muted-foreground" />
          <h1 className="text-xl font-semibold">{t("Plugin Manager", { defaultValue: "Plugin Manager" })}</h1>
        </div>
        
        <Dialog open={installDialogOpen} onOpenChange={setInstallDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              {t("Install Plugin", { defaultValue: "Install Plugin" })}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("Install Plugin", { defaultValue: "Install Plugin" })}</DialogTitle>
              <DialogDescription>
                {t("Enter the npm package name of the plugin you wish to install.", {
                  defaultValue: "Enter the npm package name of the plugin you wish to install.",
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="packageName">{t("npm Package Name", { defaultValue: "npm Package Name" })}</Label>
                <Input
                  id="packageName"
                  placeholder="@penclipai/plugin-example"
                  value={installPackage}
                  onChange={(e) => setInstallPackage(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setInstallDialogOpen(false)}>{t("Cancel", { defaultValue: "Cancel" })}</Button>
              <Button
                onClick={() => installMutation.mutate({ packageName: installPackage })}
                disabled={!installPackage || installMutation.isPending}
              >
                {installMutation.isPending
                  ? t("Installing...", { defaultValue: "Installing..." })
                  : t("Install", { defaultValue: "Install" })}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">{t("Plugins are alpha.", { defaultValue: "Plugins are alpha." })}</p>
            <p className="text-muted-foreground">
              {t("The plugin runtime and API surface are still changing. Expect breaking changes while this feature settles.", {
                defaultValue: "The plugin runtime and API surface are still changing. Expect breaking changes while this feature settles.",
              })}
            </p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("Available Plugins", { defaultValue: "Available Plugins" })}</h2>
          <Badge variant="outline">{t("Examples", { defaultValue: "Examples" })}</Badge>
        </div>

        {examplesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">{t("Loading bundled examples...", { defaultValue: "Loading bundled examples..." })}</div>
        ) : examplesQuery.error ? (
          <div className="text-sm text-destructive">{t("Failed to load bundled examples.", { defaultValue: "Failed to load bundled examples." })}</div>
        ) : examples.length === 0 ? (
          <div className="rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground">
            {t("No bundled example plugins were found in this checkout.", {
              defaultValue: "No bundled example plugins were found in this checkout.",
            })}
          </div>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {examples.map((example) => {
              const installedPlugin = installedByPackageName.get(example.packageName);
              const installPending =
                installMutation.isPending &&
                installMutation.variables?.isLocalPath &&
                installMutation.variables.packageName === example.localPath;
              const exampleDisplayName = getExampleDisplayName(example);
              const exampleDescription = getExampleDescription(example, t);
              const installedStatusLabel = installedPlugin
                ? getPluginStatusLabel(installedPlugin.status, t)
                : null;

              return (
                <li key={example.packageName}>
                  <div className="flex items-center gap-4 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{exampleDisplayName}</span>
                        <Badge variant="outline">{t("Example", { defaultValue: "Example" })}</Badge>
                        {installedPlugin ? (
                          <Badge
                            variant={installedPlugin.status === "ready" ? "default" : "secondary"}
                            className={installedPlugin.status === "ready" ? "bg-green-600 hover:bg-green-700" : ""}
                          >
                            {installedStatusLabel}
                          </Badge>
                        ) : (
                          <Badge variant="secondary">{t("Not installed", { defaultValue: "Not installed" })}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{exampleDescription}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{example.packageName}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {installedPlugin ? (
                        <>
                          {installedPlugin.status !== "ready" && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={enableMutation.isPending}
                              onClick={() => enableMutation.mutate(installedPlugin.id)}
                            >
                              {t("Enable", { defaultValue: "Enable" })}
                            </Button>
                          )}
                          <Button variant="outline" size="sm" asChild>
                            <Link to={`/instance/settings/plugins/${installedPlugin.id}`}>
                              {installedPlugin.status === "ready"
                                ? t("Open Settings", { defaultValue: "Open Settings" })
                                : t("Review", { defaultValue: "Review" })}
                            </Link>
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          disabled={installPending || installMutation.isPending}
                          onClick={() =>
                            installMutation.mutate({
                              packageName: example.localPath,
                              isLocalPath: true,
                            })
                          }
                        >
                          {installPending
                            ? t("Installing...", { defaultValue: "Installing..." })
                            : t("Install Example", { defaultValue: "Install Example" })}
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Puzzle className="h-5 w-5 text-muted-foreground" />
          <h2 className="text-base font-semibold">{t("Installed Plugins", { defaultValue: "Installed Plugins" })}</h2>
        </div>

        {!installedPlugins.length ? (
          <Card className="bg-muted/30">
            <CardContent className="flex flex-col items-center justify-center py-10">
              <Puzzle className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-sm font-medium">{t("No plugins installed", { defaultValue: "No plugins installed" })}</p>
              <p className="text-xs text-muted-foreground mt-1">
                {t("Install a plugin to extend functionality.", {
                  defaultValue: "Install a plugin to extend functionality.",
                })}
              </p>
            </CardContent>
          </Card>
        ) : (
          <ul className="divide-y rounded-md border bg-card">
            {installedPlugins.map((plugin) => (
              <li key={plugin.id}>
                <div className="flex items-start gap-4 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/instance/settings/plugins/${plugin.id}`}
                        className="font-medium hover:underline truncate block"
                        title={getPluginDisplayName(plugin)}
                      >
                        {getPluginDisplayName(plugin)}
                      </Link>
                      {examplePackageNames.has(plugin.packageName) && (
                        <Badge variant="outline">{t("Example", { defaultValue: "Example" })}</Badge>
                      )}
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={plugin.packageName}>
                        {plugin.packageName} · v{plugin.manifestJson.version ?? plugin.version}
                      </p>
                    </div>
                    <p
                      className="text-sm text-muted-foreground truncate mt-0.5"
                      title={getPluginDescription(plugin, t) ?? undefined}
                    >
                      {getPluginDescription(plugin, t)
                        || t("No description provided.", {
                          defaultValue: "No description provided.",
                        })}
                    </p>
                    {plugin.status === "error" && (
                      <div className="mt-3 rounded-md border border-red-500/25 bg-red-500/[0.06] px-3 py-2">
                        <div className="flex flex-wrap items-start gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-sm font-medium text-red-700 dark:text-red-300">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              <span>{t("Plugin error", { defaultValue: "Plugin error" })}</span>
                            </div>
                            <p
                              className="mt-1 text-sm text-red-700/90 dark:text-red-200/90 break-words"
                              title={plugin.lastError ?? undefined}
                            >
                              {errorSummaryByPluginId.get(plugin.id)}
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-red-500/30 bg-background/60 text-red-700 hover:bg-red-500/10 hover:text-red-800 dark:text-red-200 dark:hover:text-red-100"
                            onClick={() => setErrorDetailsPlugin(plugin)}
                          >
                            {t("View full error", { defaultValue: "View full error" })}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 self-center">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={
                            plugin.status === "ready"
                              ? "default"
                              : plugin.status === "error"
                                ? "destructive"
                              : "secondary"
                          }
                          className={cn(
                            "shrink-0",
                            plugin.status === "ready" ? "bg-green-600 hover:bg-green-700" : ""
                          )}
                        >
                          {getPluginStatusLabel(plugin.status, t)}
                        </Badge>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="h-8 w-8"
                          title={plugin.status === "ready"
                            ? t("Disable", { defaultValue: "Disable" })
                            : t("Enable", { defaultValue: "Enable" })}
                          onClick={() => {
                            if (plugin.status === "ready") {
                              disableMutation.mutate(plugin.id);
                            } else {
                              enableMutation.mutate(plugin.id);
                            }
                          }}
                          disabled={enableMutation.isPending || disableMutation.isPending}
                        >
                          <Power className={cn("h-4 w-4", plugin.status === "ready" ? "text-green-600" : "")} />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          title={t("Uninstall", { defaultValue: "Uninstall" })}
                          onClick={() => {
                            setUninstallPluginId(plugin.id);
                            setUninstallPluginName(getPluginDisplayName(plugin));
                          }}
                          disabled={uninstallMutation.isPending}
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                      <Button variant="outline" size="sm" className="mt-2 h-8" asChild>
                        <Link to={`/instance/settings/plugins/${plugin.id}`}>
                          <Settings className="h-4 w-4" />
                          {t("Configure", { defaultValue: "Configure" })}
                        </Link>
                      </Button>
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={uninstallPluginId !== null}
        onOpenChange={(open) => { if (!open) setUninstallPluginId(null); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Uninstall Plugin", { defaultValue: "Uninstall Plugin" })}</DialogTitle>
            <DialogDescription>
              {t("Are you sure you want to uninstall", { defaultValue: "Are you sure you want to uninstall" })}{" "}
              <strong>{uninstallPluginName}</strong>?{" "}
              {t("This action cannot be undone.", { defaultValue: "This action cannot be undone." })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUninstallPluginId(null)}>{t("Cancel", { defaultValue: "Cancel" })}</Button>
            <Button
              variant="destructive"
              disabled={uninstallMutation.isPending}
              onClick={() => {
                if (uninstallPluginId) {
                  uninstallMutation.mutate(uninstallPluginId, {
                    onSettled: () => setUninstallPluginId(null),
                  });
                }
              }}
            >
              {uninstallMutation.isPending
                ? t("Uninstalling...", { defaultValue: "Uninstalling..." })
                : t("Uninstall", { defaultValue: "Uninstall" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={errorDetailsPlugin !== null}
        onOpenChange={(open) => { if (!open) setErrorDetailsPlugin(null); }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("Error Details", { defaultValue: "Error Details" })}</DialogTitle>
            <DialogDescription>
              {errorDetailsPlugin
                ? getPluginDisplayName(errorDetailsPlugin)
                : t("Plugin", { defaultValue: "Plugin" })}{" "}
              {t("hit an error state.", { defaultValue: "hit an error state." })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border border-red-500/25 bg-red-500/[0.06] px-4 py-3">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700 dark:text-red-300" />
                <div className="space-y-1 text-sm">
                  <p className="font-medium text-red-700 dark:text-red-300">
                    {t("What errored", { defaultValue: "What errored" })}
                  </p>
                  <p className="text-red-700/90 dark:text-red-200/90 break-words">
                    {errorDetailsPlugin
                      ? getPluginErrorSummary(errorDetailsPlugin, t)
                      : t("No error summary available.", {
                        defaultValue: "No error summary available.",
                      })}
                  </p>
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("Full error output", { defaultValue: "Full error output" })}</p>
              <pre className="max-h-[50vh] overflow-auto rounded-md border bg-muted/40 p-3 text-xs leading-5 whitespace-pre-wrap break-words">
                {errorDetailsPlugin?.lastError ?? t("No stored error message.", { defaultValue: "No stored error message." })}
              </pre>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setErrorDetailsPlugin(null)}>
              {t("Close", { defaultValue: "Close" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
