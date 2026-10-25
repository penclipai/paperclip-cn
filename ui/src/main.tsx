import { VoiceCallProvider } from "./components/voice/VoiceCallProvider";
import { useAccountIdentity } from "./api/companies-query";
import * as React from "react";
import { StrictMode, Suspense } from "react";
import * as ReactDOM from "react-dom";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "@/lib/router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { ToastProvider } from "./context/ToastContext";
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
import "@mdxeditor/editor/style.css";
import "./index.css";

initPluginBridge(React, ReactDOM);
startPerfMeasureReaper();

startChunkLoadRecovery();

// Parked SPA tabs never navigate, so beyond registering the worker this also
// re-checks /sw.js on tab focus and hourly, and applies a discovered update
// with one reload while the tab is hidden — otherwise an old worker and its
// cached shell can outlive a deploy indefinitely.
window.addEventListener("load", () => {
  startServiceWorkerUpdates();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, gcTime: 5 * 60_000, refetchOnWindowFocus: true },
  },
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
