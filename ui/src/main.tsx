import { VoiceCallProvider } from "./components/voice/VoiceCallProvider";
import { useAccountIdentity } from "./api/companies-query";
import * as React from "react";
import { StrictMode, Suspense, useEffect } from "react";
import * as ReactDOM from "react-dom";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "@/lib/router";
import { QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { SentryGate } from "./components/SentryGate";
import { CompanyProvider, useCompany } from "./context/CompanyContext";
import { LiveUpdatesProvider } from "./context/LiveUpdatesProvider";
import { DesktopBridge } from "./components/DesktopBridge";
import { BreadcrumbProvider } from "./context/BreadcrumbContext";
import { PanelProvider } from "./context/PanelContext";
import { SidebarProvider } from "./context/SidebarContext";
import { DialogProvider } from "./context/DialogContext";
import { EditorAutocompleteProvider } from "./context/EditorAutocompleteContext";
import { PrimaryAgentProvider } from "./context/PrimaryAgentProvider";
import { ToastProvider, useToastActions, type ToastInput } from "./context/ToastContext";
import { ThemeProvider } from "./context/ThemeContext";
import { DesignSandboxProvider } from "./context/DesignSandboxContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { initPluginBridge } from "./plugins/bridge-init";
import { PluginLauncherProvider } from "./plugins/launchers";
import { startChunkLoadRecovery } from "./lib/chunk-load-recovery";
import { startPerfMeasureReaper } from "./lib/perf-measure-reaper";
import { getOrCreatePaperclipReactRoot } from "./lib/react-root";
import { startServiceWorkerUpdates } from "./lib/service-worker-updates";
import i18n from "./i18n";
import { connectivity } from "./lib/connectivity";
import { bindConnectivity, createAppQueryClient } from "./lib/query-client";
import { captureBrowserException } from "./lib/sentry";
import { startPersistedQueryCache } from "./lib/persisted-query-cache";
import { hasPendingWrites, subscribePendingWrites } from "./lib/reload-safety";
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);
startPerfMeasureReaper();

startChunkLoadRecovery();

// The global mutation error toast is raised from the MutationCache, outside
// React; the bridge below hands it the ToastProvider's pushToast.
let pushMutationErrorToast: ((input: ToastInput) => void) | null = null;

function MutationErrorToastBridge() {
  const { pushToast } = useToastActions();
  useEffect(() => {
    pushMutationErrorToast = pushToast;
    return () => {
      if (pushMutationErrorToast === pushToast) pushMutationErrorToast = null;
    };
  }, [pushToast]);
  return null;
}

// Retry, pause-on-outage, and error-reporting defaults live in
// lib/query-client.ts; app-specific cache tuning stays here.
const queryClient = createAppQueryClient(
  {
    connectivity,
    reportError: (error) => captureBrowserException(error),
    notifyMutationError: ({ title, body }) => pushMutationErrorToast?.({ title, body, tone: "error" }),
  },
  {
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // Explicit so cross-tab-published cache entries for resources this tab
        // isn't observing get collected promptly rather than lingering. Single
        // tuning point if we need to trim the cache footprint further.
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: true,
      },
    },
  },
);
// Outages pause queries and replayable mutations instead of failing them, and
// live queries refresh once when the server answers again.
bindConnectivity(queryClient, connectivity);
startPersistedQueryCache(queryClient, {
  buildId: typeof __PAPERCLIP_BUILD_COMMIT__ === "string" ? __PAPERCLIP_BUILD_COMMIT__ : null,
});
window.addEventListener("load", () => {
  startServiceWorkerUpdates({
    canReload: () => connectivity.getSnapshot().status === "online"
      && connectivity.getSnapshot().pendingWrites === 0 && queryClient.isMutating() === 0 && !hasPendingWrites(),
    subscribeReloadSafety: listener => {
      const cleanups = [connectivity.subscribe(listener), queryClient.getMutationCache().subscribe(listener), subscribePendingWrites(listener)];
      return () => { for (const cleanup of cleanups) cleanup(); };
    },
  });
});

function CompanyAwareBreadcrumbProvider({ children }: { children: React.ReactNode }) {
  const { selectedCompany } = useCompany();
  return <BreadcrumbProvider companyName={selectedCompany?.name ?? null}>{children}</BreadcrumbProvider>;
}

function CompanyVoiceCalls({ children }: { children: React.ReactNode }) {
  const { selectedCompanyId } = useCompany();
  const { userId } = useAccountIdentity();
  return <VoiceCallProvider companyId={selectedCompanyId} userId={userId}>{children}</VoiceCallProvider>;
}

function AppBootstrapFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground" aria-busy="true">
      {i18n.t("common.loading", { defaultValue: "" })}
    </div>
  );
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Paperclip root element is missing");

getOrCreatePaperclipReactRoot(window, rootElement).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <Suspense fallback={<AppBootstrapFallback />}>
        <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SentryGate />
        <ThemeProvider>
          <BrowserRouter>
            <CompanyProvider>
              <EditorAutocompleteProvider>
                <ToastProvider>
                  <MutationErrorToastBridge />
                  <PrimaryAgentProvider>
                  <LiveUpdatesProvider>
                    <DesktopBridge />
                    <TooltipProvider>
                      <CompanyAwareBreadcrumbProvider>
                        <SidebarProvider>
                          <PanelProvider>
                            <PluginLauncherProvider>
                              <DialogProvider>
                                <DesignSandboxProvider><CompanyVoiceCalls><App /></CompanyVoiceCalls></DesignSandboxProvider>
                              </DialogProvider>
                            </PluginLauncherProvider>
                          </PanelProvider>
                        </SidebarProvider>
                      </CompanyAwareBreadcrumbProvider>
                    </TooltipProvider>
                  </LiveUpdatesProvider>
                  </PrimaryAgentProvider>
                </ToastProvider>
              </EditorAutocompleteProvider>
            </CompanyProvider>
          </BrowserRouter>
        </ThemeProvider>
      </QueryClientProvider>
        </AppErrorBoundary>
      </Suspense>
    </I18nextProvider>
  </StrictMode>
);
