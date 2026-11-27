import type { ProjectSkillRepository } from '@penclipai/shared';
import { useTranslation } from 'react-i18next';
import { GithubIcon } from '@/components/icons/github-icon';
import { Button } from '@/components/ui/button';
import { LoaderCircle } from 'lucide-react';

export function ProjectSkillRepositoryRow({ repository, pending, backgroundPending, disabled, onImport }: {
  repository: ProjectSkillRepository;
  pending?: boolean;
  backgroundPending?: boolean;
  disabled?: boolean;
  onImport: () => void;
}) {
  const { t } = useTranslation();
  const actionPending = pending || repository.status === 'pending';
  const importing = actionPending || backgroundPending;
  return <section className="flex flex-col gap-2 py-3" aria-label={t("skillSources.projectRepo.aria", { name: repository.projectName, defaultValue: "Skills from {{name}}" })} aria-busy={Boolean(importing)}>
    <div className="flex items-center gap-3">
      <GithubIcon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <a href={repository.repositoryUrl} target="_blank" rel="noreferrer" className="block truncate text-sm font-medium hover:underline">
          {repository.repositoryUrl.replace('https://github.com/', '')}
        </a>
        <p className="truncate text-xs text-muted-foreground">{repository.projectName} · {repository.trackingRef === 'HEAD' ? t("skillSources.defaultBranch", { defaultValue: "Default branch" }) : repository.trackingRef}{repository.projectVisibility === 'private' ? ` · ${t("skillSources.projectAccess", { defaultValue: "Project access" })}` : ''}</p>
      </div>
      <Button size="sm" variant="outline" disabled={actionPending || disabled} onClick={onImport}>
        {importing && <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" />}
        {actionPending ? t("skillSources.projectRepo.importing", { defaultValue: "Importing…" }) : repository.status === 'error' ? t("skillSources.projectRepo.retryImport", { defaultValue: "Retry import" }) : backgroundPending ? t("skillSources.projectRepo.importRemaining", { defaultValue: "Import remaining skills" }) : t("skillSources.projectRepo.importSkills", { defaultValue: "Import skills" })}
      </Button>
    </div>
    {importing && <p role="status" className="ml-8 text-xs text-muted-foreground">{pending ? t("skillSources.projectRepo.startingImport", { defaultValue: "Starting import…" }) : repository.importState === 'importing'
      ? t("skillSources.projectRepo.checkingRepo", { defaultValue: "Checking repository for skills… This can take a few minutes for large repositories." }) : t("skillSources.projectRepo.importQueued", { defaultValue: "Import queued. Skills will appear here when ready." })}</p>}
    {repository.lastError && <p role="alert" className="text-sm text-destructive">{repository.lastError}</p>}
  </section>;
}
