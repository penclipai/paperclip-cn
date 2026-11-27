import { useState, type ComponentProps, type CSSProperties } from "react";
import { Bot, User } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { IssueFiltersPopover } from "./IssueFiltersPopover";
import { Button } from "./ui/button";
import { FlyoutHeader } from "./ui/flyout";
import { StatusIcon } from "./StatusIcon";
import { FilterGroup, FilterRow } from "./CollectionFilterOptions";
import { IssueUpdatedRangeInputs } from "./IssueUpdatedRangeInputs";
import { issueFilterLabel, issueStatusOrder, issueUpdatedWithinOptions, issueUpdatedWithinPatch, searchIssueFilterOptions, toggleIssueFilterValue } from "@/lib/issue-filters";

type PanelProps = Pick<ComponentProps<typeof IssueFiltersPopover>, "state" | "onChange" | "activeFilterCount" | "agents" | "projects" | "labels" | "creators" | "currentUserId" | "enableRoutineTasksFilter" | "enableAgentCreatedVisibilityFilter" | "enableLiveRunsFilter"> & { onClear: () => void };

/** The collection retains ownership of filter state. */
export function IssueFilterPanel({ state, onChange, activeFilterCount, agents = [], projects = [], labels = [], creators = [], currentUserId, onClear, enableRoutineTasksFilter, enableAgentCreatedVisibilityFilter, enableLiveRunsFilter = true }: PanelProps) {
  const { t } = useTranslation();
  const [queries, setQueries] = useState({ projects: "", creators: "", assignees: "", labels: "" });
  const search = (key: keyof typeof queries) => (value: string) => setQueries(current => ({ ...current, [key]: value }));
  const visibleProjects = searchIssueFilterOptions(projects, queries.projects, option => option.name);
  const visibleCreators = searchIssueFilterOptions(creators, queries.creators, option => `${option.label} ${option.searchText ?? ""}`);
  const assignees = [{ id: "__unassigned", name: t("issueFilters.noAssignee", { defaultValue: "No assignee" }), icon: null }, ...(currentUserId ? [{ id: "__me", name: t("Me", { defaultValue: "Me" }), icon: <User /> }] : []), ...agents.map(agent => ({ ...agent, icon: null }))];
  const visibleAssignees = searchIssueFilterOptions(assignees, queries.assignees, option => option.name);
  const visibleLabels = searchIssueFilterOptions(labels, queries.labels, option => option.name);
  return <>
    <FlyoutHeader className="task-filters-header"><span>{t("issuesList.filters", { defaultValue: "Filters" })}</span>{activeFilterCount ? <Button variant="ghost" onClick={() => { onClear(); setQueries({ projects: "", creators: "", assignees: "", labels: "" }); }}>{t("Clear", { defaultValue: "Clear" })}</Button> : null}</FlyoutHeader>
    <div className="task-filters-grid">
      <div className="task-filter-group">
        <FilterGroup title={t("Status", { defaultValue: "Status" })} optionsKey="statuses">
          {issueStatusOrder.map(status => <FilterRow key={status} label={issueFilterLabel(status)} checked={state.statuses.includes(status)} onToggle={() => onChange({ statuses: toggleIssueFilterValue(state.statuses, status) })} icon={<StatusIcon status={status} />} />)}
        </FilterGroup>
        {enableLiveRunsFilter || enableAgentCreatedVisibilityFilter || enableRoutineTasksFilter ? <FilterGroup title={t("projectWorkspace.visibility", { defaultValue: "Visibility" })} optionsKey="visibility">
          {enableLiveRunsFilter ? <FilterRow label={t("issueFilters.liveRunsOnly", { defaultValue: "Live runs only" })} checked={state.liveOnly === true} onToggle={() => onChange({ liveOnly: !state.liveOnly })} /> : null}
          {enableAgentCreatedVisibilityFilter ? <FilterRow label={t("issueFilters.showAgentCreatedTasks", { defaultValue: "Show agent-created tasks" })} checked={state.showAgentCreatedTasks} onToggle={() => onChange({ showAgentCreatedTasks: !state.showAgentCreatedTasks })} /> : null}
          {enableRoutineTasksFilter ? <FilterRow label={t("issueFilters.routineTasks", { defaultValue: "Routine tasks" })} checked={state.routineTasksOnly === true} onToggle={() => onChange({ routineTasksOnly: !state.routineTasksOnly })} /> : null}
        </FilterGroup> : null}
        <FilterGroup title={t("Updated", { defaultValue: "Updated" })} optionsKey="updated">
          {issueUpdatedWithinOptions.map(option => {
            const selected = (state.updatedWithin ?? null) === option.value;
            return <FilterRow key={option.value} label={option.label} checked={selected} onToggle={() => onChange(issueUpdatedWithinPatch(selected ? null : option.value))} />;
          })}
          {state.updatedWithin === "custom" ? <IssueUpdatedRangeInputs state={state} onChange={onChange} className="grid-cols-1" /> : null}
        </FilterGroup>
      </div>
      <FilterGroup title={t("Project", { defaultValue: "Project" })} optionsKey="projects" searchLabel={t("issueFilters.searchTarget.projects", { defaultValue: "projects" })} query={queries.projects} onQueryChange={search("projects")}>
        {visibleProjects.map(project => <FilterRow key={project.id} label={project.name} checked={state.projects.includes(project.id)} onToggle={() => onChange({ projects: toggleIssueFilterValue(state.projects, project.id) })} />)}
        {!visibleProjects.length ? <p className="task-filter-empty">{queries.projects ? t("issueFilters.noProjectsMatch", { defaultValue: "No projects match." }) : t("issueFilters.noProjectsAvailable", { defaultValue: "No projects available." })}</p> : null}
      </FilterGroup>
      <FilterGroup title={t("Creator", { defaultValue: "Creator" })} optionsKey="creators" searchLabel={t("issueFilters.searchTarget.creators", { defaultValue: "creators" })} query={queries.creators} onQueryChange={search("creators")}>
        {visibleCreators.map(creator => <FilterRow key={creator.id} label={creator.label} checked={state.creators.includes(creator.id)} onToggle={() => onChange({ creators: toggleIssueFilterValue(state.creators, creator.id) })} icon={creator.kind === "agent" ? <Bot /> : <User />} />)}
        {!visibleCreators.length ? <p className="task-filter-empty">{queries.creators ? t("No creators match.", { defaultValue: "No creators match." }) : t("issueFilters.noCreatorsAvailable", { defaultValue: "No creators available." })}</p> : null}
      </FilterGroup>
      <FilterGroup title={t("Assignee", { defaultValue: "Assignee" })} optionsKey="responsible" searchLabel={t("issueFilters.searchTarget.assignees", { defaultValue: "assignees" })} query={queries.assignees} onQueryChange={search("assignees")}>
        {visibleAssignees.map(assignee => <FilterRow key={assignee.id} label={assignee.name} checked={state.assignees.includes(assignee.id)} onToggle={() => onChange({ assignees: toggleIssueFilterValue(state.assignees, assignee.id) })} icon={assignee.icon} />)}
        {!visibleAssignees.length ? <p className="task-filter-empty">{t("issueFilters.noAssigneesMatch", { defaultValue: "No assignees match." })}</p> : null}
      </FilterGroup>
      <FilterGroup title={t("Label", { defaultValue: "Label" })} optionsKey="labels" searchLabel={t("issueFilters.searchTarget.labels", { defaultValue: "labels" })} query={queries.labels} onQueryChange={search("labels")}>
        {visibleLabels.map(label => <FilterRow key={label.id} label={label.name} checked={state.labels.includes(label.id)} onToggle={() => onChange({ labels: toggleIssueFilterValue(state.labels, label.id) })} icon={<span className="task-filter-label-dot" style={{ "--task-filter-label-color": label.color } as CSSProperties} />} />)}
        {!visibleLabels.length ? <p className="task-filter-empty">{queries.labels ? t("issueFilters.noLabelsMatch", { defaultValue: "No labels match." }) : t("issueFilters.noLabelsAvailable", { defaultValue: "No labels available." })}</p> : null}
      </FilterGroup>
    </div>
  </>;
}
