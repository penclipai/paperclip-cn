import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useMemo, type CSSProperties } from "react";
import { Folder, GitBranch, GitBranchPlus, Monitor } from "lucide-react";
import type { ExecutionWorkspaceSummary } from "@penclipai/shared";
import { SearchableSelect, type SearchableSelectOption } from "@/components/SearchableSelect";
import { orderReusableExecutionWorkspaces } from "@/lib/reusable-execution-workspaces";

interface WorktreeOption extends SearchableSelectOption {
  mode: string;
  workspaceId?: string;
  description: string;
}

interface ComposerWorktreePickerProps {
  mode: string;
  workspaceId: string;
  workspaces: readonly ExecutionWorkspaceSummary[];
  onChange: (mode: string, workspaceId: string) => void;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  disabled?: boolean;
  mobile?: boolean;
  contentStyle?: CSSProperties;
  selectedWorkspaceLabel?: string;
}

const MODE_OPTIONS: Array<Omit<WorktreeOption, "label" | "description"> & {
  labelKey: string;
  defaultLabel: string;
  descriptionKey: string;
  defaultDescription: string;
}> = [
  { key: "isolated_workspace", value: "isolated_workspace", mode: "isolated_workspace", labelKey: "newIssue.worktree.newWorktree", defaultLabel: "New worktree", descriptionKey: "newIssue.worktree.newWorktreeDesc", defaultDescription: "Start in an isolated checkout." },
  { key: "shared_workspace", value: "shared_workspace", mode: "shared_workspace", labelKey: "newIssue.worktree.projectWorkspace", defaultLabel: "Project workspace", descriptionKey: "newIssue.worktree.projectWorkspaceDesc", defaultDescription: "Use the project's shared checkout." },
  { key: "operator_branch", value: "operator_branch", mode: "operator_branch", labelKey: "newIssue.worktree.newBranch", defaultLabel: "New branch", descriptionKey: "newIssue.worktree.newBranchDesc", defaultDescription: "Create a branch in the project workspace." },
  { key: "agent_default", value: "agent_default", mode: "agent_default", labelKey: "newIssue.worktree.agentDefault", defaultLabel: "Agent default", descriptionKey: "newIssue.worktree.agentDefaultDesc", defaultDescription: "Let the agent choose its workspace." },
  { key: "inherit", value: "inherit", mode: "inherit", labelKey: "newIssue.worktree.projectDefault", defaultLabel: "Project default", descriptionKey: "newIssue.worktree.projectDefaultDesc", defaultDescription: "Use the project's worktree settings." },
];

/** Reuses the searchable selector and the existing workspace recency ordering. */
export function ComposerWorktreePicker({
  mode, workspaceId, workspaces, onChange, loading, error, onRetry,
  disabled, mobile, contentStyle, selectedWorkspaceLabel,
}: ComposerWorktreePickerProps) {
  const { t, i18n } = useTranslation();
  const translatedModes = useMemo<WorktreeOption[]>(
    () => MODE_OPTIONS.map((option) => ({
      key: option.key,
      value: option.value,
      mode: option.mode,
      label: t(option.labelKey, { defaultValue: option.defaultLabel }),
      description: t(option.descriptionKey, { defaultValue: option.defaultDescription }),
    })),
    [i18n.language, t],
  );
  const groups = useMemo(() => [
    { id: "new", options: [translatedModes[0]!] },
    {
      id: "reuse", label: t("Reuse a worktree", { defaultValue: "Reuse a worktree" }),
      options: orderReusableExecutionWorkspaces(workspaces).map((workspace): WorktreeOption => ({
        key: `reuse:${workspace.id}`, value: `reuse:${workspace.id}`,
        workspaceId: workspace.id, mode: "reuse_existing", label: workspace.name,
        description: workspace.branchName ?? t("newIssue.worktree.existingWorkspace", { defaultValue: "Existing workspace" }),
        searchText: `${workspace.branchName ?? ""} ${workspace.id}`,
      })),
    },
    {
      id: "other", label: t("Other options", { defaultValue: "Other options" }),
      options: translatedModes.filter((option) => option.mode === "shared_workspace"
        || (option.mode !== "isolated_workspace" && option.mode === mode)),
    },
  ], [mode, t, translatedModes, workspaces]);

  const value = mode === "reuse_existing" ? `reuse:${workspaceId}` : mode;
  return (
    <SearchableSelect<string, WorktreeOption>
      value={value}
      groups={groups}
      onValueChange={(_, option) => onChange(option.mode, option.workspaceId ?? "")}
      placeholder={t("Worktrees", { defaultValue: "Worktrees" })}
      triggerAriaLabel={t("Worktrees", { defaultValue: "Worktrees" })}
      mobileTitle={t("Worktrees", { defaultValue: "Worktrees" })}
      searchPlaceholder={t("newIssue.worktree.searchPlaceholder", { defaultValue: "Search worktrees..." })}
      emptyMessage={t("No matching worktrees.", { defaultValue: "No matching worktrees." })}
      disabled={disabled}
      modal={mobile}
      contentStyle={contentStyle}
      contentWidth="auto"
      className="min-w-0 flex-1 sm:flex-none sm:max-w-72"
      triggerClassName="h-8 gap-1.5 border-0 bg-transparent px-2 text-xs font-medium shadow-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-0"
      renderValue={(option) => (
        <span className="flex min-w-0 items-center gap-1.5">
          <GitBranch className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            <span className="hidden text-muted-foreground sm:inline">{t("Worktrees ·", { defaultValue: "Worktrees ·" })}{" "}</span>
            {option?.label ?? selectedWorkspaceLabel ?? t("newIssue.worktree.selectWorktree", { defaultValue: "Select worktree" })}
          </span>
        </span>
      )}
      renderOption={(option) => {
        const Icon = option.workspaceId ? GitBranch : option.mode === "isolated_workspace" ? GitBranchPlus
          : option.mode === "agent_default" ? Monitor : option.mode === "operator_branch" ? GitBranch : Folder;
        return (
          <>
            <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{option.label}</span>
              <span className="truncate text-xs text-muted-foreground">{option.description}</span>
            </span>
          </>
        );
      }}
      listFooter={loading || error || workspaces.length === 0 ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground" role="status">
          {loading ? t("newIssue.worktree.loading", { defaultValue: "Loading existing worktrees…" }) : error ? (
            <span className="flex items-center justify-between gap-2">
              {t("Couldn't load worktrees.", { defaultValue: "Couldn't load worktrees." })}<button type="button" className="rounded px-2 py-1 text-foreground hover:bg-accent" onClick={onRetry}>{t("Retry", { defaultValue: "Retry" })}</button>
            </span>
          ) : t("newIssue.worktree.empty", { defaultValue: "No existing worktrees yet. Choose New worktree to start one." })}
        </div>
      ) : undefined}
    />
  );
}
