import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { useStreamlinedUiEnabled } from "@/hooks/useStreamlinedUiEnabled";
import { SKILLS_NAVIGATION_HREFS, type SkillsNavigationView } from "@/pages/skills/skills-navigation";
import { useTranslation } from "react-i18next";

const views = [
  { value: "installed", labelKey: "companySkills.discoveryTab.installed" },
  { value: "discover", label: "Discover" },
  { value: "authored", labelKey: "folders.mySkills" },
] as const;

/** Route navigation with the canonical tab appearance. Sources stays in the actions menu. */
export function SkillsNavigationTabs({ activeView }: { activeView: SkillsNavigationView }) {
  const { t } = useTranslation();
  return <nav aria-label="Skills views" data-canonical-tabs="standard" className="canonical-tab-list">
    {views.map(view => <Link key={view.value} to={SKILLS_NAVIGATION_HREFS[view.value]}
      className="canonical-tab" data-state={activeView === view.value ? "active" : "inactive"}
      aria-current={activeView === view.value ? "page" : undefined}>{"labelKey" in view ? t(view.labelKey) : view.label}</Link>)}
  </nav>;
}

/** Standalone Skills pages share navigation beneath their own header controls. */
export function SkillsPageNavigation({ activeView, fallback = null }: { activeView: SkillsNavigationView; fallback?: ReactNode }) {
  const { enabled } = useStreamlinedUiEnabled();
  return enabled ? <div className="shrink-0 border-b border-border px-3 py-2"><SkillsNavigationTabs activeView={activeView} /></div> : fallback;
}
