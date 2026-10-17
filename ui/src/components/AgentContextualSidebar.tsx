import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  BadgeDollarSign,
  BookOpenText,
  History,
  KeyRound,
  Library,
  MessageSquare,
  PlayCircle,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { agentsApi } from "@/api/agents";
import { useCompany } from "@/context/CompanyContext";
import { queryKeys } from "@/lib/queryKeys";
import { ContextualSidebarFrame } from "./ContextualSidebarFrame";
import { SidebarNavItem } from "./SidebarNavItem";
import { contextualSidebarStyles } from "./contextual-sidebar-styles";
import {
  AGENT_DETAIL_NAVIGATION,
  agentDetailHref,
  agentScopedAuditHref,
  type AgentLocalDetailView,
} from "@/pages/agent-detail-navigation";

const localIcons = {
  overview: Sparkles,
  instructions: BookOpenText,
  skills: Library,
  runtime: Settings2,
  secrets: ShieldCheck,
  tools: Wrench,
  channels: MessageSquare,
  permissions: ShieldCheck,
  "api-keys": KeyRound,
  revisions: History,
} satisfies Record<AgentLocalDetailView, typeof Sparkles>;

const auditItems = [
  { section: "activity", labelKey: "Activity", icon: Activity },
  { section: "runs", labelKey: "Runs", icon: PlayCircle },
  { section: "costs", labelKey: "Costs", icon: ReceiptText },
  { section: "budgets", labelKey: "Budgets", icon: BadgeDollarSign },
] as const;

export function AgentContextualSidebar({
  agentRef,
  agentId,
  agentName,
  labels,
}: {
  agentRef: string;
  agentId?: string;
  agentName?: string;
  labels?: Partial<Record<AgentLocalDetailView, string>>;
}) {
  useTranslation();
  const { selectedCompanyId } = useCompany();
  const shouldResolveAgent = !agentId || !agentName;
  const { data: resolvedAgent } = useQuery({
    queryKey: [...queryKeys.agents.detail(agentRef), selectedCompanyId ?? null, "contextual-sidebar"],
    queryFn: () => agentsApi.get(agentRef, selectedCompanyId ?? undefined),
    enabled: shouldResolveAgent && Boolean(agentRef && selectedCompanyId),
  });
  const resolvedId = agentId ?? resolvedAgent?.id;
  const resolvedName = agentName ?? resolvedAgent?.name ?? translateInstant("Agent");

  return (
    <ContextualSidebarFrame
      surface="agent"
      title={resolvedName}
      fallbackTo="/agents/all"
      showHeader={false}
      className="border-r border-border bg-background"
    >
      <nav
        aria-label={translateInstant("agentDetail.navigationAriaLabel", { name: resolvedName })}
        data-slot="contextual-sidebar-nav"
        className={contextualSidebarStyles.nav}
      >
        {AGENT_DETAIL_NAVIGATION.map((section) => (
          <div
            key={section.labelKey}
            data-slot="contextual-sidebar-section"
            className={contextualSidebarStyles.section}
          >
            <p
              data-slot="contextual-sidebar-section-label"
              className={contextualSidebarStyles.sectionLabel}
            >
              {translateInstant(section.labelKey)}
            </p>
            <div data-slot="contextual-sidebar-group" className={contextualSidebarStyles.group}>
              {section.items
                .map((item) => {
                  const href = agentDetailHref(agentRef, item.value);
                  return (
                    <SidebarNavItem
                      key={item.value}
                      to={href}
                      label={labels?.[item.value] ?? translateInstant(item.labelKey)}
                      icon={localIcons[item.value]}
                    />
                  );
                })}
            </div>
          </div>
        ))}

        <div data-slot="contextual-sidebar-section" className={contextualSidebarStyles.section}>
          <p
            data-slot="contextual-sidebar-section-label"
            className={contextualSidebarStyles.sectionLabel}
          >
            {translateInstant("auditFeed.title")}</p>
          <div data-slot="contextual-sidebar-group" className={contextualSidebarStyles.group}>
            {resolvedId ? auditItems.map((item) => (
              <SidebarNavItem
                key={item.section}
                to={agentScopedAuditHref(resolvedId, item.section)}
                label={translateInstant(item.labelKey)}
                icon={item.icon}
              />
            )) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">{translateInstant("Loading audit links…")}</p>
            )}
          </div>
        </div>
      </nav>
    </ContextualSidebarFrame>
  );
}
