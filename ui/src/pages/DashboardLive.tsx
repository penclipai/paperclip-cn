import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import { useEffect } from "react";
import { ArrowLeft, RadioTower } from "lucide-react";
import { Link } from "@/lib/router";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { EmptyState } from "../components/EmptyState";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";

const DASHBOARD_LIVE_RUN_LIMIT = 50;

export function DashboardLive() {
  useTranslation();
  const { selectedCompanyId, companies } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([
      { label: translateInstant("Dashboard"), href: "/dashboard" },
      { label: translateInstant("dashboardLive.breadcrumb") },
    ]);
  }, [setBreadcrumbs]);

  if (!selectedCompanyId) {
    return (
      <EmptyState
        icon={RadioTower}
        message={companies.length === 0 ? "Create an organization to view live runs." : "Select an organization to view live runs."}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to="/dashboard"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {translateInstant("dashboard.title")}</Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">{translateInstant("dashboardLive.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {translateInstant("dashboardLive.description")}</p>
        </div>
        <div className="text-sm text-muted-foreground">{translateInstant("issuesList.showingUpTo")}{" "}{DASHBOARD_LIVE_RUN_LIMIT}</div>
      </div>

      <ActiveAgentsPanel
        companyId={selectedCompanyId}
        title={translateInstant("dashboardLive.activeRecentTitle")}
        minRunCount={DASHBOARD_LIVE_RUN_LIMIT}
        fetchLimit={DASHBOARD_LIVE_RUN_LIMIT}
        cardLimit={DASHBOARD_LIVE_RUN_LIMIT}
        emptyMessage={translateInstant("dashboardLive.noActiveRuns")}
        queryScope="dashboard-live"
        showMoreLink={false}
      />
    </div>
  );
}
