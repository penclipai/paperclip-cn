import { useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Issue, IssueDocument, IssueWorkProduct } from "@penclipai/shared";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  GitBranch,
  GitCommit,
  Globe,
  Package,
  Paperclip,
  Server,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { useIssueDocuments } from "@/hooks/useIssueDocuments";
import {
  documentDisplayTitle,
  selectAgentArtifactAttachments,
  workProductHref,
} from "@/lib/issue-artifacts";
import { attachmentOpenPath } from "@/lib/issue-attachments";
import { MarkdownBody } from "@/components/MarkdownBody";
import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface IssuePropertiesArtifactsTabProps {
  issue: Issue;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function workProductIcon(type: string): LucideIcon {
  switch (type) {
    case "document": return FileText;
    case "pull_request": return GitBranch;
    case "branch": return GitBranch;
    case "commit": return GitCommit;
    case "preview_url": return Globe;
    case "runtime_service": return Server;
    default: return Package;
  }
}

/** Work-product status → label + `--status-task-*` base-hue var for `.status-chip`. */
function workProductStatusBadge(status: string): { key: string; cssVar: string } | null {
  switch (status) {
    case "active":
    case "draft":
      return { key: "artifactsPanel.status.inProgress", cssVar: "--status-task-in_progress" };
    case "ready_for_review":
      return { key: "artifactsPanel.status.forReview", cssVar: "--status-task-in_review" };
    case "approved":
    case "merged":
      return { key: "status.done", cssVar: "--status-task-done" };
    case "changes_requested":
      return { key: "artifactsPanel.status.changesRequested", cssVar: "--status-task-todo" };
    case "failed":
      return { key: "artifactsPanel.status.failed", cssVar: "--status-task-blocked" };
    default:
      return null;
  }
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-1 pt-1 text-(length:--text-micro) font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

const ROW_CLASS =
  "flex items-center gap-2 rounded-md border border-border bg-card/50 px-2.5 py-1.5 text-sm";

function WorkProductRow({ workProduct }: { workProduct: IssueWorkProduct }) {
  const { t } = useTranslation();
  const Icon = workProductIcon(workProduct.type);
  const badge = workProductStatusBadge(workProduct.status);
  const href = workProductHref(workProduct);
  const body = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{workProduct.title}</span>
      {badge ? (
        <span
          className="status-chip inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-(length:--text-nano) leading-none whitespace-nowrap"
          style={{ "--sc": `var(${badge.cssVar})` } as CSSProperties}
        >
          {t(badge.key)}
        </span>
      ) : null}
      {href ? (
        <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
      ) : null}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={cn(ROW_CLASS, "hover:bg-accent/50")}
      >
        {body}
      </a>
    );
  }
  return <div className={ROW_CLASS}>{body}</div>;
}

function DocumentRow({ doc }: { doc: IssueDocument }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div className="rounded-md border border-border bg-card/50">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent/50"
        aria-expanded={expanded}
      >
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{documentDisplayTitle(doc)}</span>
        <span className="shrink-0 text-(length:--text-micro) text-muted-foreground">
          {t("issueProperties.artifacts.revision", { revision: doc.latestRevisionNumber ?? 1 })}
        </span>
        <Chevron className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>
      {expanded ? (
        <div className="border-t border-border px-2.5 py-2">
          {doc.body.trim().length > 0 ? (
            <MarkdownBody>{doc.body}</MarkdownBody>
          ) : (
            <p className="text-sm text-muted-foreground">{t("artifactsPanel.documentEmpty")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Artifacts tab of the properties pane (PAP-491).
 *
 * A read-only "what did this task produce" view composed from three sources:
 * work products, issue documents (also readable in the Plan tab — the
 * redundancy is intentional), and agent-created attachments. Attachments
 * already promoted to attachment-backed work products are deduped out, and
 * user uploads are excluded — those stay first-class in the conversation
 * thread.
 */
export function IssuePropertiesArtifactsTab({ issue }: IssuePropertiesArtifactsTabProps) {
  const { t } = useTranslation();
  const { data: attachments } = useQuery({
    queryKey: queryKeys.issues.attachments(issue.id),
    queryFn: () => issuesApi.listAttachments(issue.id),
  });
  const { data: workProducts } = useQuery({
    queryKey: queryKeys.issues.workProducts(issue.id),
    queryFn: () => issuesApi.listWorkProducts(issue.id),
  });
  const { data: documents } = useIssueDocuments(issue.id);

  const workProductRows = workProducts ?? [];
  const documentRows = documents ?? [];
  const fileRows = selectAgentArtifactAttachments(attachments, workProducts);

  if (workProductRows.length === 0 && documentRows.length === 0 && fileRows.length === 0) {
    return (
      <div className="px-1 py-6 text-sm text-muted-foreground">
        {t("issueProperties.artifacts.empty")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 py-2">
      {workProductRows.length > 0 ? (
        <>
          <SectionHeading>{t("issueProperties.artifacts.workProducts")}</SectionHeading>
          <ul className="flex flex-col gap-1">
            {workProductRows.map((wp) => (
              <li key={wp.id}>
                <WorkProductRow workProduct={wp} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {documentRows.length > 0 ? (
        <>
          <SectionHeading>{t("issueProperties.artifacts.documents")}</SectionHeading>
          <ul className="flex flex-col gap-1">
            {documentRows.map((doc) => (
              <li key={doc.key}>
                <DocumentRow doc={doc} />
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {fileRows.length > 0 ? (
        <>
          <SectionHeading>{t("issueProperties.artifacts.files")}</SectionHeading>
          <ul className="flex flex-col gap-1">
            {fileRows.map((a) => (
              <li key={a.id}>
                <a
                  href={attachmentOpenPath(a)}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(ROW_CLASS, "hover:bg-accent/50")}
                >
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{a.originalFilename ?? a.objectKey}</span>
                  <span className="shrink-0 text-(length:--text-micro) text-muted-foreground">{formatBytes(a.byteSize)}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
