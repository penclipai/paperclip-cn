import type { ComponentProps, ReactNode, Ref } from "react";
import { ChevronDown, CirclePlus, Columns3, List, ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IssueFiltersPopover } from "./IssueFiltersPopover";
import { Button } from "./ui/button";
import { ToolbarSearch } from "./ToolbarSearch";
import { FlyoutHeader, FlyoutOptions } from "./ui/flyout";
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { taskListViews as views, type TaskListView } from "@/lib/task-list-views";

/** Canonical proposed task toolbar; review under Components / Toolbars / Tasks. */
export function TaskListToolbar({ view, onViewChange, viewOptions = views, viewControl, query, onQueryChange, searchRef, layout, onLayoutChange, allExpanded, onToggleExpanded, onNewTask, filters }: {
  view: TaskListView;
  onViewChange: (view: TaskListView) => void;
  viewOptions?: readonly { value: TaskListView; label: string }[];
  viewControl?: ReactNode;
  query: string;
  onQueryChange: (query: string) => void;
  searchRef?: Ref<HTMLInputElement>;
  layout: "list" | "board";
  onLayoutChange: (layout: "list" | "board") => void;
  allExpanded: boolean;
  onToggleExpanded: () => void;
  onNewTask: () => void;
  filters: ComponentProps<typeof IssueFiltersPopover>;
}) {
  const { t } = useTranslation();
  const activeViewLabel = viewOptions.find(option => option.value === view)!.label;
  const expandLabel = allExpanded
    ? t("taskList.collapseAllTasks", { defaultValue: "Collapse all tasks" })
    : t("taskList.expandAllTasks", { defaultValue: "Expand all tasks" });
  return (
    <div data-canonical-toolbar="tasks" className="design-page-toolbar" role="toolbar" aria-label={t("taskList.controlsAria", { defaultValue: "Task list controls" })}>
      {viewControl ?? <DropdownMenu>
        <DropdownMenuTrigger asChild><Button variant="outline" className="design-toolbar-button design-view-trigger" aria-label={t("taskList.taskViewAria", { label: activeViewLabel, defaultValue: "Task view: {{label}}" })}>{activeViewLabel}<ChevronDown aria-hidden /></Button></DropdownMenuTrigger>
        <DropdownMenuContent collisionPadding={8} align="start" className="task-list-options" aria-label={t("taskList.viewsAria", { defaultValue: "Task views" })}>
          <DropdownMenuLabel asChild><FlyoutHeader className="task-list-options-heading">{t("taskList.views", { defaultValue: "Views" })}</FlyoutHeader></DropdownMenuLabel>
          <DropdownMenuRadioGroup asChild value={view} onValueChange={value => onViewChange(value as TaskListView)}><FlyoutOptions className="task-list-options-items">
            {viewOptions.map(option => <DropdownMenuRadioItem className="task-list-options-item" key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </FlyoutOptions></DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>}
      <ToolbarSearch
        query={query}
        onQueryChange={onQueryChange}
        inputRef={searchRef}
        label={t("issuesList.searchAria")}
        placeholder={t("taskList.searchPlaceholder", { defaultValue: "Search tasks…" })}
        clearLabel={t("searchPage.clearSearch")}
      />
      <div className="design-view-toggle" role="group" aria-label={t("taskList.layoutAria", { defaultValue: "Task layout" })}>
        {[{ value: "list", label: t("List view"), icon: List }, { value: "board", label: t("Board view"), icon: Columns3 }].map(({ value, label, icon: Icon }) => (
          <Tooltip key={value}><TooltipTrigger asChild><Button variant="ghost" className="design-toolbar-button design-toolbar-icon" aria-label={label} aria-pressed={layout === value} onClick={() => onLayoutChange(value as "list" | "board")}><Icon aria-hidden /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>
        ))}
      </div>
      <div className="design-toolbar-actions">
        <Tooltip><TooltipTrigger asChild><Button variant="outline" className="design-toolbar-button design-toolbar-icon" disabled={layout !== "list"} aria-label={expandLabel} onClick={onToggleExpanded}><ListTree aria-hidden /></Button></TooltipTrigger><TooltipContent>{expandLabel}</TooltipContent></Tooltip>
        <div className="design-toolbar-filter"><IssueFiltersPopover {...filters} presentation="refreshed" buttonVariant="outline" iconOnly enableExternalObjectFilters={false} /></div>
        <Button className="design-toolbar-button design-new-task" onClick={onNewTask}><CirclePlus aria-hidden />{t("sidebar.newTask")}</Button>
      </div>
    </div>
  );
}
