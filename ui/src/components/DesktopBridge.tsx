import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { toCompanyRelativePath } from "@/lib/company-routes";
import { useNavigate } from "@/lib/router";
import type { LiveRunForIssue } from "@/api/heartbeats";
import { authApi } from "@/api/auth";
import { healthApi } from "@/api/health";

function isSafeDesktopPath(path: string): boolean {
  return path.startsWith("/")
    && !path.startsWith("//")
    && !/[\\\\\u0000-\u001f\s%]/.test(path)
    && !/(?:^|\/)(?:auth|login|setup|invite|cli-auth|mcp-connect|dot-connect)(?:\/|$)/i.test(path);
}

const LIVE_RUN_CACHE_MAX_AGE_MS = 60_000;

function isLiveRunsQueryForCompany(queryKey: readonly unknown[], companyId: string): boolean {
  return queryKey[0] === "live-runs" && queryKey[1] === companyId;
}

function activeRunCount(queryClient: ReturnType<typeof useQueryClient>, companyId: string): number | null {
  const queries = queryClient.getQueryCache().findAll({
    queryKey: queryKeys.liveRuns(companyId),
  });
  const runIds = new Set<string>();
  let foundFreshCache = false;
  for (const query of queries) {
    if (!isLiveRunsQueryForCompany(query.queryKey, companyId)) continue;
    if (Date.now() - query.state.dataUpdatedAt > LIVE_RUN_CACHE_MAX_AGE_MS) continue;
    const runs = query.state.data as LiveRunForIssue[] | undefined;
    if (!Array.isArray(runs)) continue;
    foundFreshCache = true;
    for (const run of runs) {
      if (run.status === "running") runIds.add(run.id);
    }
  }
  if (!foundFreshCache || runIds.size === 0) return null;
  // The live-runs cache may be capped by the active-agents view. A positive
  // value is therefore a conservative lower bound for quit copy; zero cannot
  // prove the company has no other active work.
  return runIds.size;
}

function liveRunsCacheStamp(queryClient: ReturnType<typeof useQueryClient>, companyId: string): number {
  return queryClient.getQueryCache().findAll({ queryKey: queryKeys.liveRuns(companyId) })
    .filter((query) => isLiveRunsQueryForCompany(query.queryKey, companyId))
    .reduce((latest, query) => Math.max(latest, query.state.dataUpdatedAt), 0);
}

function canSendDesktopCompanyContext(
  sessionStatus: string,
  hasSession: boolean,
  deploymentMode: string | undefined,
): boolean {
  return sessionStatus === "success" && (hasSession || deploymentMode === "local_trusted");
}

/** Keeps native-shell context current without starting any extra network work. */
export function DesktopBridge() {
  const { i18n } = useTranslation();
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const sentContextRef = useRef<string | null>(null);
  const { data: session, status: sessionStatus } = useQuery({
    queryKey: queryKeys.auth.session,
    queryFn: () => authApi.getSession(),
    retry: false,
  });
  const { data: health } = useQuery({
    queryKey: queryKeys.health,
    queryFn: healthApi.get,
  });
  const canSendCompany = canSendDesktopCompanyContext(
    sessionStatus,
    session != null,
    health?.deploymentMode,
  );

  useEffect(() => {
    const setContext = window.desktopShell?.setContext;
    if (!setContext) return;
    const locale = i18n.resolvedLanguage === "zh-CN" || i18n.language === "zh-CN" ? "zh-CN" : "en";
    const send = (activeRuns: number | null) => {
      const context = {
        locale,
        companyId: canSendCompany ? selectedCompanyId : null,
        activeRuns,
      } as const;
      const cacheStamp = context.companyId ? liveRunsCacheStamp(queryClient, context.companyId) : 0;
      const serialized = `${JSON.stringify(context)}:${cacheStamp}`;
      if (serialized === sentContextRef.current) return;
      sentContextRef.current = serialized;
      void setContext(context).catch(() => undefined);
    };
    // Do not carry a previous company's running count into the confirmation
    // dialog while the new company's cache is still warming up.
    send(null);
    if (canSendCompany && selectedCompanyId) send(activeRunCount(queryClient, selectedCompanyId));
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      const queryKey = event?.query?.queryKey;
      if (!canSendCompany || !selectedCompanyId || !queryKey || !isLiveRunsQueryForCompany(queryKey, selectedCompanyId)) return;
      send(activeRunCount(queryClient, selectedCompanyId));
    });
    return () => {
      unsubscribe();
      void setContext({ locale, companyId: null, activeRuns: null }).catch(() => undefined);
    };
  }, [canSendCompany, i18n.language, i18n.resolvedLanguage, queryClient, selectedCompanyId]);

  useEffect(() => {
    const subscribe = window.desktopShell?.onNavigate;
    if (!subscribe) return;
    return subscribe((path) => {
      if (!isSafeDesktopPath(path)) return;
      navigate(toCompanyRelativePath(path));
    });
  }, [navigate]);

  return null;
}

export const __desktopBridgeTestUtils = {
  activeRunCount,
  canSendDesktopCompanyContext,
  isLiveRunsQueryForCompany,
  isSafeDesktopPath,
  liveRunsCacheStamp,
};
