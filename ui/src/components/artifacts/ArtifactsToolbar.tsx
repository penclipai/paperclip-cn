import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import { Check, Layers } from "lucide-react";
import type { ArtifactGroupBy, ArtifactKindFilter } from "@/api/artifacts";
import { TabFilters, type TabSize } from "@/components/TabBar";
import { Button } from "@/components/ui/button";
import { ToolbarSearch } from "@/components/ToolbarSearch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const ARTIFACT_KIND_FILTERS: { value: ArtifactKindFilter; label: string }[] = [
  { value: "all", get label() { return translateInstant("artifacts.filter.all", { defaultValue: "All" }); } },
  { value: "image", get label() { return translateInstant("artifacts.filter.images", { defaultValue: "Images" }); } },
  { value: "video", get label() { return translateInstant("artifacts.filter.videos", { defaultValue: "Videos" }); } },
  { value: "document", get label() { return translateInstant("artifacts.filter.documents", { defaultValue: "Documents" }); } },
  { value: "text", get label() { return translateInstant("artifacts.filter.text", { defaultValue: "Text" }); } },
  { value: "file", get label() { return translateInstant("artifacts.filter.files", { defaultValue: "Files" }); } },
];

export const ARTIFACT_GROUP_OPTIONS: { value: ArtifactGroupBy; label: string }[] = [
  { value: "none", get label() { return translateInstant("artifacts.group.none", { defaultValue: "None" }); } },
  { value: "task", get label() { return translateInstant("artifacts.group.task", { defaultValue: "Task" }); } },
  { value: "parent_task", get label() { return translateInstant("artifacts.group.parentTask", { defaultValue: "Parent task" }); } },
];

export function artifactGroupByLabel(value: ArtifactGroupBy): string {
  return ARTIFACT_GROUP_OPTIONS.find((option) => option.value === value)?.label ?? translateInstant("artifacts.group.none", { defaultValue: "None" });
}

/** Canonical collection filters; compact standalone, standard in the toolbar. */
export function ArtifactKindFilters({ kind, onKindChange, size = "compact" }: { kind: ArtifactKindFilter; onKindChange: (value: ArtifactKindFilter) => void; size?: TabSize }) {
  const { t } = useTranslation();
  return <TabFilters items={ARTIFACT_KIND_FILTERS} value={kind} onValueChange={onKindChange} size={size} label={t("artifacts.filterAria", { defaultValue: "Filter artifacts by type" })} />;
}

export interface ArtifactsToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  groupBy: ArtifactGroupBy;
  onGroupByChange: (value: ArtifactGroupBy) => void;
  kind: ArtifactKindFilter;
  onKindChange: (value: ArtifactKindFilter) => void;
  /** Replaces the kind filter row (Artifacts V1 shows its own view tabs). */
  filters?: ReactNode;
}

/** Shared shipped Artifacts controls. Canonical proposal: Components / Toolbars / Artifacts. */
export function ArtifactsToolbar({ query: draftQuery, onQueryChange: setDraftQuery, groupBy, onGroupByChange: selectGroupBy, kind, onKindChange: selectKind, filters }: ArtifactsToolbarProps) {
  const { t } = useTranslation();
  const grouping = groupBy !== "none";
  return (
    <div data-canonical-toolbar="artifacts" role="toolbar" aria-label={t("artifacts.controlsAria", { defaultValue: "Artifacts controls" })} className="flex flex-col items-start gap-4">
      <div className="design-toolbar-controls flex w-full flex-wrap items-center gap-4">
        <ToolbarSearch
          query={draftQuery}
          onQueryChange={setDraftQuery}
          label={t("artifacts.searchAria", { defaultValue: "Search artifacts" })}
          placeholder={t("artifacts.searchPlaceholder", { defaultValue: "Search artifacts…" })}
          clearLabel={t("artifacts.clearSearch", { defaultValue: "Clear artifact search" })}
        />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("artifacts.groupAria", { group: artifactGroupByLabel(groupBy), defaultValue: "Group artifacts (currently {{group}})" })}
              title={t("artifacts.groupTitle", { defaultValue: "Group artifacts" })}
              data-testid="artifact-group-control"
              data-group-by={groupBy}
              data-active={grouping}
              className={cn("h-8 w-8 shrink-0", grouping && "bg-accent")}
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>{t("artifacts.groupBy", { defaultValue: "Group by" })}</DropdownMenuLabel>
            {ARTIFACT_GROUP_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.value}
                data-testid={`artifact-group-option-${option.value}`}
                aria-selected={groupBy === option.value}
                onSelect={() => selectGroupBy(option.value)}
                className="justify-between"
              >
                {option.label}
                {groupBy === option.value ? <Check className="h-3.5 w-3.5" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {filters ?? <ArtifactKindFilters kind={kind} onKindChange={selectKind} size="standard" />}
    </div>
  );
}
