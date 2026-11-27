import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { isWaitingToStart } from "../lib/agent-queue-wait";
import {
  Inbox,
  ListChecks,
  CircleDot,
  Target,
  LayoutDashboard,
  DollarSign,
  History,
  Search,
  SquarePen,
  Network,
  Boxes,
  Repeat,
  Layers,
  GitBranch,
  Package,
  Settings,
  FolderOpen,
  Unplug,
  MessagesSquare,
  GanttChartSquare,
  LayoutGrid,
  Compass,
} from "lucide-react";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SidebarSection } from "./SidebarSection";
import { SidebarNavItem } from "./SidebarNavItem.production";
import { SidebarAgents } from "./SidebarAgents.production";
import { SidebarProjects } from "./SidebarProjects";
import { SidebarStarredProjects } from "./SidebarStarredProjects.production";
import { useDialogActions } from "../context/DialogContext";
import { useCompany } from "../context/CompanyContext";
import { heartbeatsApi } from "../api/heartbeats";
import { instanceSettingsApi } from "../api/instanceSettings";
import { queryKeys } from "../lib/queryKeys";
import { useAttentionBadge } from "../hooks/useAttentionViews";
import { useInboxBadge } from "../hooks/useInboxBadge";
import { useResponsibilitiesEnabled } from "../hooks/useResponsibilitiesEnabled";
import { usePublishSharedQueryData, useSharedPollingQuery } from "../hooks/useSharedPolling";
import { PluginSlotOutlet } from "@/plugins/slots";
import { PluginLauncherOutlet } from "@/plugins/launchers";
import { SidebarCompanyMenu } from "./SidebarCompanyMenu.production";

export function Sidebar() {
  useTranslation();
  const { openNewIssue } = useDialogActions();
  // Every labeled section is collapsible (session-scoped, default open) —
  // one policy across static nav groups and the data-driven sections.
  const [workOpen, setWorkOpen] = useState(true);
  const [companyOpen, setCompanyOpen] = useState(true);
  const { selectedCompanyId, selectedCompany } = useCompany();
  const inboxBadge = useInboxBadge(selectedCompanyId);
  const { data: experimentalSettings } = useQuery({
    queryKey: queryKeys.instance.experimentalSettings,
    queryFn: () => instanceSettingsApi.getExperimental(),
  });
  const liveRunsQueryKey = queryKeys.liveRuns(selectedCompanyId!);
  const sharedLiveRuns = useSharedPollingQuery({
    companyId: selectedCompanyId,
    resourceKey: "live-runs",
    queryKey: liveRunsQueryKey,
    enabled: !!selectedCompanyId,
    // Event-sourced via LiveUpdatesProvider (GitHub issue 9627) + reconnect reconcile — no
    // interval poll needed. Polling here also re-armed React Query's timer on
    // every live-event cache write, a major source of steady-state churn.
    refetchInterval: false,
    leaderOnly: true,
  });
  const { data: liveRuns, dataUpdatedAt: liveRunsUpdatedAt } = useQuery({
    queryKey: liveRunsQueryKey,
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!),
    enabled: sharedLiveRuns.enabled,
    refetchInterval: sharedLiveRuns.refetchInterval,
  });
  usePublishSharedQueryData(sharedLiveRuns, liveRuns, liveRunsUpdatedAt);
  const liveRunCount = (liveRuns ?? []).filter((run) => !isWaitingToStart(run)).length;
  const showWorkspacesLink = experimentalSettings?.enableIsolatedWorkspaces === true;
  const showApps = experimentalSettings?.enableApps === true;
  const showStatusCards = experimentalSettings?.enableStatusCards === true;
  const goalsLinkPending = experimentalSettings === undefined;
  const showGoalsLink = experimentalSettings?.enableGoalsSidebarLink === true;
  // Decisions (attention home) is an experimental surface (PAP-13481): the nav
  // item is hidden entirely until the flag is enabled (same no-flash pattern as
  // showWorkspacesLink — it defaults hidden, so no placeholder is needed).
  const showDecisions = experimentalSettings?.enableDecisions === true;
  // The shared "For you" badge (PAP-749 Rule 5): same query as the Decisions
  // page and the coordinator navigation, with no midnight reset.
  const { count: attentionCount } = useAttentionBadge(selectedCompanyId, {
    enabled: showDecisions,
    refetchInterval: 60_000,
  });
  const showCases = experimentalSettings?.enableCases === true;
  // Streamlined left navigation (top-level Projects link + starred children) is
  // now the standard product sidebar (PAP-12472). The former experimental
  // opt-out was retired; classic per-project collapsible mode is no longer
  // user-selectable. Kept as a constant so the classic branch below stays as a
  // documented reference until it is fully removed. Routes are unaffected.
  const streamlined = true;
  // Conference Room Chat flag (PAP-136/PAP-137): the Conference Room nav item
  // is a new surface, hidden entirely while the flag is off (same no-flash
  // pattern as showWorkspacesLink above).
  const conferenceRoomChatEnabled = experimentalSettings?.enableConferenceRoomChat === true;
  // Responsibilities (experimental) is home: it leads the primary group with
  // Tasks and Inbox directly beneath it (this shell has no Chat row), and
  // Dashboard moves down into Work.
  const { enabled: responsibilitiesHome } = useResponsibilitiesEnabled();
  const tasksItem = <SidebarNavItem to="/issues" label={translateInstant("sidebar.issues")} icon={CircleDot} />;
  // The classic dashboard. With Responsibilities as home that page takes the "Dashboard" name and this row is not shown.
  const dashboardItem = <SidebarNavItem to="/dashboard" label={translateInstant("Dashboard")} icon={LayoutDashboard} liveCount={liveRunCount} />;

  const pluginContext = {
    companyId: selectedCompanyId,
    companyPrefix: selectedCompany?.issuePrefix ?? null,
  };

  return (
    <aside className="w-full h-full min-h-0 border-r border-border bg-background flex flex-col">
      {/* Top bar: company name, aligned with top sections and borderless.
          Search deliberately does NOT live here:
          the header's spare width goes to the workspace/organization name,
          which is the user's orientation anchor and truncates otherwise.
          Search is the first nav item below instead. */}
      <div className="flex items-center gap-1 px-3 h-12 shrink-0">
        <SidebarCompanyMenu />
      </div>

      <nav aria-label={translateInstant("sidebar.workspaceNavigation", { defaultValue: "Workspace navigation" })} className="flex-1 min-h-0 overflow-y-auto scrollbar-auto-hide flex flex-col gap-4 pointer-coarse:gap-3 px-3 py-2">
        <div className="flex flex-col gap-0.5">
          {/* New Task button aligned with nav items */}
          <button
            onClick={() => openNewIssue()}
            data-slot="icon-button"
            className="flex items-center gap-2.5 mx-2 rounded-lg px-2 py-1.5 pointer-coarse:py-1 text-(length:--text-compact) font-medium text-foreground/80 hover:bg-accent/50 hover:text-foreground transition-colors"
          >
            <SquarePen className="h-4 w-4 shrink-0" />
            <span className="truncate">{translateInstant("sidebar.newTask")}</span>
          </button>
          <SidebarNavItem to="/search" label={translateInstant("Search")} icon={Search} />
          {responsibilitiesHome ? (
            <>
              <SidebarNavItem to="/responsibilities" label={translateInstant("Dashboard")} icon={Compass} />
              {tasksItem}
            </>
          ) : dashboardItem}
          <SidebarNavItem
            to="/inbox"
            label={translateInstant("Inbox")}
            icon={Inbox}
            badge={inboxBadge.inbox}
            badgeLabel={translateInstant("unread")}
            badgeTone={inboxBadge.failedRuns > 0 ? "danger" : "default"}
            alert={inboxBadge.failedRuns > 0}
          />
          {showDecisions ? (
            <SidebarNavItem
              to="/decisions"
              label={translateInstant("instanceExperimentalSettings.decisionsTitle")}
              icon={ListChecks}
              badge={attentionCount}
              badgeLabel={translateInstant("sidebar.decisions", { defaultValue: "decisions" })}
            />
          ) : null}
          {showStatusCards ? (
            <SidebarNavItem to="/status" label={translateInstant("Status")} icon={LayoutGrid} textBadge={translateInstant("common.beta", { defaultValue: "beta" })} />
          ) : null}
          {conferenceRoomChatEnabled ? (
            <SidebarNavItem to="/board-chat" label={translateInstant("Conference Room")} icon={MessagesSquare} />
          ) : null}
        </div>

        <SidebarSection label={translateInstant("Work")} collapsible={{ open: workOpen, onOpenChange: setWorkOpen }}>
          {responsibilitiesHome ? null : tasksItem}
          {showCases ? (
            <SidebarNavItem to="/cases" label={translateInstant("Cases")} icon={Layers} textBadge={translateInstant("common.beta", { defaultValue: "beta" })} />
          ) : null}
          <SidebarNavItem to="/routines" label={translateInstant("Routines")} icon={Repeat} />
          {showGoalsLink ? (
            <SidebarNavItem to="/goals" label={translateInstant("Goals")} icon={Target} />
          ) : goalsLinkPending ? (
            <div
              data-testid="sidebar-goals-placeholder"
              className="h-8 pointer-coarse:h-7"
              aria-hidden="true"
            />
          ) : null}
          <SidebarNavItem to="/artifacts" label={translateInstant("Artifacts")} icon={Package} />
          <SidebarNavItem to="/skills" label={translateInstant("Skills")} icon={Boxes} />
          {showWorkspacesLink ? (
            <SidebarNavItem to="/workspaces" label={translateInstant("Workspaces")} icon={GitBranch} />
          ) : null}
          {streamlined ? (
            <>
              <SidebarNavItem to="/projects" label={translateInstant("Projects")} icon={FolderOpen} />
              <SidebarStarredProjects />
            </>
          ) : null}
          <PluginSlotOutlet
            slotTypes={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
            missingBehavior="placeholder"
          />
          <PluginLauncherOutlet
            placementZones={["sidebar"]}
            context={pluginContext}
            className="flex flex-col gap-0.5"
            itemClassName="text-(length:--text-compact) font-medium"
          />
        </SidebarSection>

        {/* Classic mode restores the per-project collapsible below Work. */}
        {streamlined ? null : <SidebarProjects />}

        <SidebarAgents streamlined={streamlined} />

        <SidebarSection label={translateInstant("Company")} collapsible={{ open: companyOpen, onOpenChange: setCompanyOpen }}>
          <SidebarNavItem to="/org" label={translateInstant("Org")} icon={Network} />
          {showApps ? <SidebarNavItem to="/apps" label={translateInstant("Plugins")} icon={Unplug} /> : null}
          <SidebarNavItem to="/timeline" label={translateInstant("sidebar.timeline")} icon={GanttChartSquare} />
          <SidebarNavItem to="/costs" label={translateInstant("Costs")} icon={DollarSign} />
          {/* One entry — /audit merged into the rich Activity feed (PAP-16302). */}
          <SidebarNavItem to="/activity" label={translateInstant("Activity")} icon={History} />
          <SidebarNavItem to="/activity/commentary" label={translateInstant("sidebar.commentary")} icon={History} />
          <SidebarNavItem to="/company/settings" label={translateInstant("Settings")} icon={Settings} />
        </SidebarSection>

        <PluginSlotOutlet
          slotTypes={["sidebarPanel"]}
          context={pluginContext}
          className="flex flex-col gap-3"
          itemClassName="rounded-lg border border-border p-3"
          missingBehavior="placeholder"
        />
      </nav>
    </aside>
  );
}
