import { translateInstant } from "@/i18n";
import { useQuery } from "@tanstack/react-query";
import { FolderGit2, GitFork } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CompanySkillDetail } from "@penclipai/shared";
import { Link } from "@/lib/router";
import { companySkillsApi } from "@/api/companySkills";
import { queryKeys } from "@/lib/queryKeys";
import { skillStudioRoute } from "@/lib/company-skill-routes";
import { formatLineageLabel } from "@/lib/skill-fork";
import { Button } from "@/components/ui/button";

/**
 * Lineage chip for forked skills (PAP-13112, plan §3.1): "Forked from
 * `owner/repo` @ `<short-sha>`" linking back to the original. The fork row only
 * carries `forkedFromSkillId`, so the original's source locator/ref are fetched
 * on demand; if the original is gone we still link by id with a soft label.
 */
export function SkillLineageChip({
  companyId,
  forkedFromSkillId,
}: {
  companyId: string;
  forkedFromSkillId: string | null;
}) {
  const { t } = useTranslation();
  const originalQuery = useQuery({
    queryKey: queryKeys.companySkills.detail(
      companyId,
      forkedFromSkillId ?? "",
    ),
    queryFn: () => companySkillsApi.detail(companyId, forkedFromSkillId!),
    enabled: Boolean(companyId && forkedFromSkillId),
    staleTime: 60_000,
  });

  if (!forkedFromSkillId) return null;

  const original = originalQuery.data;
  const label = original
    ? formatLineageLabel(original)
    : t("skillStudio.provenance.originalSkill", {
        defaultValue: "the original skill",
      });

  return (
    <Link
      to={skillStudioRoute(forkedFromSkillId)}
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      title={t("skillStudio.provenance.forkedFrom", {
        defaultValue: "Forked from {{source}}",
        source: label,
      })}
    >
      <GitFork className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {t("skillStudio.provenance.forkedFromPrefix", {
          defaultValue: "Forked from",
        })}{" "}
        <span className="font-medium text-foreground">{label}</span>
      </span>
    </Link>
  );
}

/**
 * Persistent source notice for repo-synced (`project_scan`) skills (PAP-13112,
 * plan §3.3). These stay editable, but their saves land as uncommitted writes
 * in the user's project checkout — disclosed here, with a secondary path to
 * fork instead of touching the tree. No behaviour change (§3.3, Dotta 07-08).
 */
export function ProjectScanNotice({
  skill,
  onEditACopy,
}: {
  skill: CompanySkillDetail;
  onEditACopy: () => void;
}) {
  const { t } = useTranslation();
  const location =
    skill.sourcePath ??
    skill.sourceLabel ??
    t("skillStudio.provenance.projectWorkingTree", {
      defaultValue: "the project working tree",
    });

  return (
    <div className="flex flex-wrap items-start gap-2 border-b border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <FolderGit2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <span>
          {t("skillStudio.provenance.skillLivesIn", {
            defaultValue: "This skill lives in",
          })}{" "}
          <span className="font-mono text-foreground">{location}</span>{translateInstant(".")}{" "}
          {t("skillStudio.provenance.uncommittedSaves", {
            defaultValue:
              "Saves write to the project working tree and are not committed.",
          })}
        </span>{" "}
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto p-0 text-xs"
          onClick={onEditACopy}
        >
          {t("skillStudio.provenance.editCopyInstead", {
            defaultValue: "Edit a copy instead",
          })}
        </Button>
      </div>
    </div>
  );
}
