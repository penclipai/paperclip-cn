import { ToolbarSearch } from "@/components/ToolbarSearch";
import type { ReactNode } from "react";
import { ChevronDown, Compass, FolderSearch, Globe, Pencil, Plus, RefreshCw } from "lucide-react";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { GithubIcon } from "@/components/icons/github-icon";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";

export type DiscoverySort = "agents" | "stars" | "forks" | "recent" | "alphabetical";

const DISCOVERY_SORT_LABEL_KEYS: Record<DiscoverySort, { key: string; defaultValue: string }> = {
  agents: { key: "Most agents", defaultValue: "Most agents" },
  stars: { key: "companySkills.sort.stars", defaultValue: "Most stars" },
  forks: { key: "companySkills.sort.forks", defaultValue: "Most forks" },
  recent: { key: "companySkills.sort.recent", defaultValue: "Recently updated" },
  alphabetical: { key: "companySkills.sort.alphabetical", defaultValue: "Alphabetical" },
};

const DISCOVERY_SORTS: DiscoverySort[] = ["agents", "stars", "forks", "recent", "alphabetical"];

export interface SkillsToolbarProps {
  viewTitle: string;
  viewDescription: string;
  searchLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
  sort: DiscoverySort;
  onSortChange: (value: DiscoverySort) => void;
  availableSources: { value: string; label: string }[];
  sourceBadgeFilter: string;
  setSourceBadgeFilter: (value: string) => void;
  onScan: () => void;
  scanPending: boolean;
  onCreate: () => void;
  onBrowseDiscover: () => void;
  onImport: () => void;
  onImportFromProject: () => void;
  folderControl?: ReactNode;
  navigation?: ReactNode;
  onCreateFolder?: () => void;
  selectMode?: boolean;
  onToggleSelectMode?: () => void;
}

/** Shared shipped Skills controls. Canonical proposal: Components / Toolbars / Skills. */
export function SkillsToolbar({ viewTitle, viewDescription, searchLabel, search, onSearchChange, sort, onSortChange, availableSources, sourceBadgeFilter, setSourceBadgeFilter, onScan, scanPending, onCreate, onBrowseDiscover, onImport, onImportFromProject, folderControl, onCreateFolder, selectMode, onToggleSelectMode, navigation }: SkillsToolbarProps) {
  const { t } = useTranslation();
  const sortLabel = (option: DiscoverySort) => t(DISCOVERY_SORT_LABEL_KEYS[option].key, { defaultValue: DISCOVERY_SORT_LABEL_KEYS[option].defaultValue });
  return (
    <div data-canonical-toolbar="skills" role="toolbar" aria-label={t("companySkills.toolbar.ariaLabel", { defaultValue: "Skills controls" })} className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      <div className="w-full">
        <h1 className="text-lg font-semibold text-foreground">{viewTitle}</h1>
        <p className="text-xs text-muted-foreground">{viewDescription}</p>
      </div>
      <ToolbarSearch query={search} onQueryChange={onSearchChange} label={searchLabel} placeholder={`${searchLabel}…`} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <span className="text-muted-foreground">{t("companySkills.toolbar.sort", { defaultValue: "Sort" })}</span>
            <span>{sortLabel(sort)}</span>
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup value={sort} onValueChange={(value) => onSortChange(value as DiscoverySort)}>
            {DISCOVERY_SORTS.map((option) => (
              <DropdownMenuRadioItem key={option} value={option}>
                {sortLabel(option)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {availableSources.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <span className="text-muted-foreground">{t("companySkills.toolbar.source", { defaultValue: "Source" })}</span>
              <span>
                {sourceBadgeFilter === "all"
                  ? t("companySkills.allSources")
                  : availableSources.find((source) => source.value === sourceBadgeFilter)?.label ?? t("All", { defaultValue: "All" })}
              </span>
              <ChevronDown className="ml-1 h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={sourceBadgeFilter} onValueChange={setSourceBadgeFilter}>
              <DropdownMenuRadioItem value="all">{t("companySkills.allSources")}</DropdownMenuRadioItem>
              {availableSources.map((source) => (
                <DropdownMenuRadioItem key={source.value} value={source.value}>
                  {source.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onScan()}
        disabled={scanPending}
        aria-label={t("companySkills.scanProjectWorkspaces")}
        title={t("companySkills.scanProjectWorkspaces")}
      >
        <RefreshCw className={cn("h-4 w-4", scanPending && "animate-spin")} />
      </Button>
      {folderControl}
      {onCreateFolder ? (
        <Button variant="outline" size="sm" onClick={onCreateFolder}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          {t("folders.newFolder")}
        </Button>
      ) : null}
      {onToggleSelectMode ? (
        <Button variant="outline" size="sm" aria-pressed={selectMode} onClick={onToggleSelectMode}>
          {selectMode ? t("Done", { defaultValue: "Done" }) : t("Select", { defaultValue: "Select" })}
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="default" data-toolbar-primary>
            <Plus className="mr-1 h-3.5 w-3.5" />
            {t("companySkills.toolbar.newMenu", { defaultValue: "New" })}
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onCreate}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("companySkills.toolbar.createNewSkill", { defaultValue: "Create new skill" })}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onBrowseDiscover}>
            <Compass className="mr-2 h-4 w-4" />
            {t("Discover skills", { defaultValue: "Discover skills" })}
          </DropdownMenuItem>
          <DropdownMenuItem asChild><Link to="/skills/sources/new"><GithubIcon className="mr-2 h-4 w-4" />{t("Import from GitHub", { defaultValue: "Import from GitHub" })}</Link></DropdownMenuItem>
          <DropdownMenuItem asChild><Link to="/skills/sources">{t("companySkills.toolbar.manageSources", { defaultValue: "Manage sources" })}</Link></DropdownMenuItem>
          <DropdownMenuItem onSelect={onImport}>
            <Globe className="mr-2 h-4 w-4" />
            {t("companySkills.toolbar.importFromPathOrUrl", { defaultValue: "Import from path or URL" })}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onImportFromProject}>
            <FolderSearch className="mr-2 h-4 w-4" />
            {t("companySkills.toolbar.importFromProject", { defaultValue: "Import skills from project" })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {navigation ? <div className="w-full">{navigation}</div> : null}
    </div>
  );
}
