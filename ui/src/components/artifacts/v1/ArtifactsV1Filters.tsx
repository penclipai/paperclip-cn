import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import type { ArtifactGroupBy, ArtifactKindFilter } from "@/api/artifacts";
import { TabFilters, type TabBarItem } from "@/components/TabBar";

/**
 * The Artifacts page's one row of views (mock node 2129:133457): Tasks —
 * one tile per task, the default — then every file flat, by type. Grouping
 * and the kind filter are still two URL parameters; a view maps onto both.
 */
export type ArtifactsV1View = "tasks" | Exclude<ArtifactKindFilter, never>;

export const ARTIFACTS_V1_VIEWS: TabBarItem<ArtifactsV1View>[] = [
  { value: "tasks", get label() { return translateInstant("artifacts.v1.tasks", { defaultValue: "Tasks" }); } },
  { value: "all", get label() { return translateInstant("artifacts.v1.allFiles", { defaultValue: "All files" }); } },
  { value: "image", get label() { return translateInstant("artifacts.filter.images", { defaultValue: "Images" }); } },
  { value: "video", get label() { return translateInstant("artifacts.filter.videos", { defaultValue: "Videos" }); } },
  { value: "document", get label() { return translateInstant("artifacts.filter.documents", { defaultValue: "Documents" }); } },
  { value: "text", get label() { return translateInstant("artifacts.filter.text", { defaultValue: "Text" }); } },
  { value: "file", get label() { return translateInstant("artifacts.filter.files", { defaultValue: "Files" }); } },
];

/** Any grouping reads as the Tasks view; flat views are named by their kind. */
export const artifactsV1View = (groupBy: ArtifactGroupBy, kind: ArtifactKindFilter): ArtifactsV1View => (groupBy !== "none" ? "tasks" : kind);

export function ArtifactsV1Filters({ view, onViewChange }: { view: ArtifactsV1View; onViewChange: (view: ArtifactsV1View) => void }) {
  const { t } = useTranslation();
  return <TabFilters items={ARTIFACTS_V1_VIEWS} value={view} onValueChange={onViewChange} size="standard" label={t("artifacts.v1.filterAria", { defaultValue: "Show artifacts by task or by type" })} />;
}
