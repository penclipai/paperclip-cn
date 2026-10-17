import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { NewAgentSetup } from "../components/new-agent/NewAgentSetup";

export function NewAgent() {
  useTranslation();
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([
      { label: translateInstant("Agents"), href: "/agents" },
      { label: translateInstant("New agent") },
    ]);
  }, [setBreadcrumbs]);
  return <NewAgentSetup />;
}
