import { useState } from "react";
import { Check, FolderOpen, Loader2, Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover";

export interface AllowedProjectsEditorProps {
  projects: Array<{ id: string; name: string }>;
  projectIds: string[];
  canManage: boolean;
  agentName: string;
  onSave: (projectIds: string[]) => Promise<unknown>;
}

export function AllowedProjectsEditor({ projects, projectIds, canManage, agentName, onSave }: AllowedProjectsEditorProps) {
  const { t } = useTranslation();
  const [added, setAdded] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = added.filter(id => !projectIds.includes(id));
  const visibleIds = [...new Set([...projectIds, ...pending])];
  const name = (id: string) => projects.find(project => project.id === id)?.name ?? t("projectAccess.unavailableProject", { defaultValue: "Unavailable project" });
  const matches = projects.filter(project => project.name.toLowerCase().includes(query.toLowerCase()));

  async function save() {
    if (!canManage || saving || !pending.length) return;
    setSaving(true); setError(null); setSaved(false);
    try { await onSave(pending); setAdded([]); setSaved(true); }
    catch (failure) { setError(failure instanceof Error ? failure.message : t("projectAccess.saveFailed", { defaultValue: "Couldn’t save project access." })); }
    finally { setSaving(false); }
  }

  return <section aria-label={t("projectAccess.allowedProjects", { defaultValue: "Allowed projects" })} className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1"><h3 className="text-sm font-semibold">{t("projectAccess.allowedProjects", { defaultValue: "Allowed projects" })}</h3>
        <p className="text-sm text-muted-foreground">{t("projectAccess.allowedProjectsDescription", { defaultValue: "Projects whose tasks and repositories this agent may access." })}</p></div>
      {canManage && <Popover open={open} onOpenChange={setOpen}><PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={saving}><Plus className="size-4" aria-hidden />{t("projectAccess.addProject", { defaultValue: "Add project" })}</Button>
      </PopoverTrigger><PopoverContent align="end" className="w-72 space-y-3">
        <Input aria-label={t("projectAccess.searchProjects", { defaultValue: "Search projects…" })} placeholder={t("projectAccess.searchProjects", { defaultValue: "Search projects…" })} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="max-h-64 space-y-1 overflow-y-auto">{matches.map(project => <label key={project.id} className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-accent">
          <Checkbox aria-label={project.name} checked={projectIds.includes(project.id) || pending.includes(project.id)} disabled={projectIds.includes(project.id)} className="mt-0.5"
            onCheckedChange={checked => { setAdded(current => checked ? [...new Set([...current, project.id])] : current.filter(id => id !== project.id)); setSaved(false); }} />
          <span className="min-w-0 text-sm">{project.name}{projectIds.includes(project.id) && <span className="block text-xs text-muted-foreground">{t("projectAccess.alreadyAllowed", { defaultValue: "Already allowed" })}</span>}</span>
        </label>)}</div>
        {!matches.length && <p className="text-sm text-muted-foreground">{t("projectAccess.noProjectsFound", { defaultValue: "No projects found." })}</p>}
        <Button variant="secondary" size="sm" className="w-full" onClick={() => setOpen(false)}>{t("projectAccess.done", { defaultValue: "Done" })}</Button>
      </PopoverContent></Popover>}
    </div>
    {visibleIds.length ? <ul aria-label={t("projectAccess.allowedProjects", { defaultValue: "Allowed projects" })} className="divide-y divide-border rounded-lg border">
      {visibleIds.map(id => <li key={id} className="flex items-center gap-3 p-4">
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 flex-1 break-words text-sm font-medium">{name(id)}</span>
        {projectIds.includes(id) ? <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Check className="size-3.5" aria-hidden />{t("projectAccess.allowed", { defaultValue: "Allowed" })}</span>
          : <><span className="text-xs text-muted-foreground">{t("projectAccess.toAdd", { defaultValue: "To add" })}</span><Button variant="ghost" size="icon-sm" disabled={saving} aria-label={t("projectAccess.undoAdding", { projectName: name(id), defaultValue: "Undo adding {{projectName}}" })} onClick={() => setAdded(current => current.filter(value => value !== id))}><X className="size-4" aria-hidden /></Button></>}
      </li>)}
    </ul> : <p className="text-sm text-muted-foreground">{t("projectAccess.noProjectsAllowed", { defaultValue: "No projects allowed yet." })}</p>}
    {!canManage && <p className="text-sm text-muted-foreground">{t("projectAccess.noManageEditorDescription", { defaultValue: "A person with agent-management permission can add projects here." })}</p>}
    {pending.length > 0 && <div className="space-y-2 rounded-md bg-muted p-4 text-sm">
      <p className="font-medium">{t("projectAccess.addAccess", { projects: pending.map(name).join(", "), defaultValue: "Add access to {{projects}}" })}</p>
      <p className="text-muted-foreground">{pending.length === 1
        ? t("projectAccess.pendingDescriptionSingle", { agentName, defaultValue: "{{agentName}} will be able to access work and repositories in this project. Existing project access and low-trust restrictions stay in place." })
        : t("projectAccess.pendingDescriptionPlural", { agentName, defaultValue: "{{agentName}} will be able to access work and repositories in these projects. Existing project access and low-trust restrictions stay in place." })}</p>
    </div>}
    {error && <p role="alert" className="text-sm text-destructive">{t("projectAccess.saveFailedWithSelection", { error, defaultValue: "Couldn’t save project access. Your selection is kept. {{error}}" })}</p>}
    {saved && <p role="status" className="inline-flex items-center gap-2 text-sm"><Check className="size-4" aria-hidden />{t("projectAccess.saved", { defaultValue: "Project access saved. Return to your task to retry." })}</p>}
    {canManage && <div className="flex items-center justify-between gap-3 border-t pt-4">
      <Button variant="ghost" disabled={saving || !pending.length} onClick={() => { setAdded([]); setError(null); setSaved(false); }}>{t("projectAccess.cancel", { defaultValue: "Cancel" })}</Button>
      <Button disabled={saving || !pending.length} onClick={() => void save()}>{saving && <Loader2 className="size-4 animate-spin" aria-hidden />}{saving ? t("projectAccess.saving", { defaultValue: "Saving access…" }) : error ? t("projectAccess.trySavingAgain", { defaultValue: "Try saving again" }) : t("projectAccess.save", { defaultValue: "Save project access" })}</Button>
    </div>}
  </section>;
}
