import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock,
  ExternalLink,
  FileText,
  GitCommitHorizontal,
  GraduationCap,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  Play,
  Trash2,
} from "lucide-react";
import type { AttentionItem, DecisionTrainingExample } from "@penclipai/shared";
import { Link } from "@/lib/router";
import {
  decisionTrainingApi,
  type DecisionTrainingTarget,
} from "../api/decisionTraining";
import { useToastActions } from "../context/ToastContext";
import { queryKeys } from "../lib/queryKeys";
import {
  codeResolutionLabel,
  decisionTrainingHref,
  trainingTargetForItem,
} from "../lib/decisionTraining";
import { relativeTime } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "./ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "./ui/alert-dialog";

function decisionOutcomeLabel(t: TFunction, outcome: string) {
  return t(`decisionTraining.drawer.outcome.${outcome}`, {
    defaultValue: outcome,
  });
}

const NOTES_PLACEHOLDER =
  "How you thought about it, what signals mattered, what you decided and why…";

interface DecisionTrainingDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  /** The Decisions row being trained; null when the drawer is closed. */
  item: AttentionItem | null;
  currentUserId?: string | null;
}

/**
 * Right-hand drawer for capturing a decision-training example from a Decisions
 * row. Renders a create state (immutable snapshot preview + notes)
 * for untrained decisions and a saved state (provenance, editable notes,
 * read-only snapshot, delete) once an example exists. Write affordances are
 * only ever mounted for human users — agents never see this drawer.
 */
export function DecisionTrainingDrawer({
  open,
  onOpenChange,
  companyId,
  item,
  currentUserId,
}: DecisionTrainingDrawerProps) {
  const { t } = useTranslation();
  const [createdExample, setCreatedExample] = useState<{
    itemId: string;
    exampleId: string;
  } | null>(null);
  const locallyCreatedExampleId =
    createdExample && createdExample.itemId === item?.id
      ? createdExample.exampleId
      : null;
  const savedExampleId = item?.trainingExampleId ?? locallyCreatedExampleId;

  const target = item ? trainingTargetForItem(item) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-full gap-0 p-0 sm:max-w-lg"
        data-testid="decision-training-drawer"
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle className="flex items-center gap-2">
            <GraduationCap className="size-4 text-muted-foreground" />
            {savedExampleId
              ? t("decisionTraining.drawer.title.saved", {
                  defaultValue: "Training example",
                })
              : t("decisionTraining.drawer.title.create", {
                  defaultValue: "Train this decision",
                })}
          </SheetTitle>
          <SheetDescription>
            {savedExampleId
              ? t("decisionTraining.drawer.description.saved", {
                  defaultValue:
                    "The frozen state is read-only; your notes stay editable.",
                })
              : t("decisionTraining.drawer.description.create", {
                  defaultValue:
                    "Freeze this decision's state and record how you'd want it decided.",
                })}
          </SheetDescription>
        </SheetHeader>

        {!item || !target ? (
          <div className="p-4 text-sm text-muted-foreground">
            {t("decisionTraining.notAnchored")}
          </div>
        ) : savedExampleId ? (
          <SavedState
            exampleId={savedExampleId}
            companyId={companyId}
            currentUserId={currentUserId}
            onDeleted={() => {
              setCreatedExample(null);
              onOpenChange(false);
            }}
          />
        ) : (
          <CreateState
            companyId={companyId}
            item={item}
            target={target}
            onCreated={(example) =>
              setCreatedExample({ itemId: item.id, exampleId: example.id })
            }
            onCancel={() => onOpenChange(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}

function CreateState({
  companyId,
  item,
  target,
  onCreated,
  onCancel,
}: {
  companyId: string;
  item: AttentionItem;
  target: DecisionTrainingTarget;
  onCreated: (example: DecisionTrainingExample) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [notes, setNotes] = useState("");

  const preview = useQuery({
    queryKey: [
      ...queryKeys.decisionTraining.list(companyId),
      "preview",
      target.sourceKind,
      target.sourceId,
      target.issueId,
    ],
    queryFn: () => decisionTrainingApi.preview(companyId, target),
    enabled: true,
  });

  const create = useMutation({
    mutationFn: () =>
      decisionTrainingApi.create(companyId, { ...target, notes: notes.trim() }),
    onSuccess: (example) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.attention(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.decisionTraining.list(companyId),
      });
      pushToast({ title: "Decision trained", tone: "success" });
      onCreated(example);
    },
    onError: (error) => {
      pushToast({
        title: "Could not train this decision",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        <DecisionContext
          item={item}
          outcome={preview.data?.decisionOutcome ?? null}
        />

        <section className="space-y-2">
          <label
            htmlFor="training-notes"
            className="text-sm font-medium text-foreground"
          >
            {t("decisionTraining.drawer.notes.yourNotes")}
          </label>
          <Textarea
            id="training-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder={NOTES_PLACEHOLDER}
            className="min-h-40 text-sm"
          />
        </section>

        <SnapshotPreview
          heading="State frozen with this example"
          snapshot={preview.data?.snapshot ?? null}
          cutoffAt={preview.data?.cutoffAt ?? null}
          loading={preview.isLoading}
          error={preview.isError ? (preview.error as Error).message : null}
        />
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border p-4">
        <Button variant="ghost" onClick={onCancel} disabled={create.isPending}>
          {t("common.cancel")}
        </Button>
        <Button
          onClick={() => create.mutate()}
          disabled={create.isPending || preview.isError}
        >
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          {t("decisionTraining.drawer.actions.saveExample")}
        </Button>
      </div>
    </div>
  );
}

function SavedState({
  exampleId,
  companyId,
  currentUserId,
  onDeleted,
}: {
  exampleId: string;
  companyId: string;
  currentUserId?: string | null;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { pushToast } = useToastActions();
  const [editing, setEditing] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");

  const example = useQuery({
    queryKey: queryKeys.decisionTraining.detail(exampleId),
    queryFn: () => decisionTrainingApi.get(exampleId),
  });

  const saveNotes = useMutation({
    mutationFn: () =>
      decisionTrainingApi.updateNotes(exampleId, draftNotes.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData(
        queryKeys.decisionTraining.detail(exampleId),
        updated,
      );
      queryClient.invalidateQueries({
        queryKey: queryKeys.decisionTraining.list(companyId),
      });
      pushToast({ title: "Notes updated", tone: "success" });
      setEditing(false);
    },
    onError: (error) => {
      pushToast({
        title: "Could not update notes",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
  });

  const remove = useMutation({
    mutationFn: () => decisionTrainingApi.delete(exampleId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.attention(companyId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.decisionTraining.list(companyId),
      });
      pushToast({ title: "Training example deleted", tone: "info" });
      onDeleted();
    },
    onError: (error) => {
      pushToast({
        title: "Could not delete example",
        body: error instanceof Error ? error.message : "Please try again.",
        tone: "error",
      });
    },
  });

  if (example.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />{" "}
        {t("decisionTraining.loadingExample")}
      </div>
    );
  }
  if (example.isError || !example.data) {
    return (
      <div className="p-4 text-sm text-destructive">
        {example.isError
          ? (example.error as Error).message
          : "Example not found."}
      </div>
    );
  }

  const record = example.data;
  const edited = record.updatedAt !== record.createdAt;
  const authorLabel =
    currentUserId && record.createdByUserId === currentUserId
      ? "You"
      : `User ${record.createdByUserId.slice(0, 8)}`;

  const startEditing = () => {
    setDraftNotes(record.notes);
    setEditing(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {/* Provenance strip */}
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          data-testid="training-provenance"
        >
          <span className="font-medium text-foreground">{authorLabel}</span>
          <span>·</span>
          <span title={new Date(record.createdAt).toLocaleString()}>
            {t("issueProperties.created")} {relativeTime(record.createdAt)}
          </span>
          {edited && (
            <>
              <span>·</span>
              <span title={new Date(record.updatedAt).toLocaleString()}>
                {t("training.columns.edited")} {relativeTime(record.updatedAt)}
              </span>
            </>
          )}
        </div>

        {/* Notes — the one editable surface */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-foreground">
              {t("decisionTraining.drawer.notes.title")}
            </span>
            {!editing && (
              <Button variant="ghost" size="xs" onClick={startEditing}>
                <Pencil className="size-3.5" /> {t("common.edit")}
              </Button>
            )}
          </div>
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={draftNotes}
                onChange={(event) => setDraftNotes(event.target.value)}
                placeholder={NOTES_PLACEHOLDER}
                className="min-h-40 text-sm"
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(false)}
                  disabled={saveNotes.isPending}
                >
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  onClick={() => saveNotes.mutate()}
                  disabled={saveNotes.isPending}
                >
                  {saveNotes.isPending && (
                    <Loader2 className="size-4 animate-spin" />
                  )}
                  {t("decisionTraining.drawer.actions.saveNotes")}
                </Button>
              </div>
            </div>
          ) : record.notes ? (
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {record.notes}
            </p>
          ) : (
            <p className="text-sm italic text-muted-foreground">
              {t("decisionTraining.drawer.notes.empty")}
            </p>
          )}
          {record.notesHistory.length > 0 && (
            <p className="text-(length:--text-nano) text-muted-foreground">
              {record.notesHistory.length} {t("decisionTraining.previous")}{" "}
              {record.notesHistory.length === 1 ? "revision" : "revisions"}
            </p>
          )}
        </section>

        <SnapshotPreview
          heading="Frozen state"
          snapshot={record.snapshot}
          cutoffAt={record.cutoffAt}
          readOnly
          exampleId={record.id}
        />
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border p-4">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={remove.isPending}
            >
              {remove.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              {t("common.delete")}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t("decisionTraining.drawer.delete.title")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("decisionTraining.drawer.delete.description")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => remove.mutate()}
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button asChild variant="outline" size="sm">
          <Link to={decisionTrainingHref(record.id)}>
            {t("decisionTraining.drawer.actions.openRecord")}
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

/** Decision context block — what was decided (or that it's still pending). */
function DecisionContext({
  item,
  outcome,
}: {
  item: AttentionItem;
  outcome: string | null;
}) {
  const { t } = useTranslation();
  return (
    <section
      className="space-y-1 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="training-context"
    >
      <p className="text-(length:--text-nano) font-medium uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
        {t("decisionTraining.drawer.context.fallbackTitle")}
      </p>
      <p className="line-clamp-2 text-sm font-medium text-foreground">
        {item.subject.title ?? "Decision"}
      </p>
      <p className="text-xs text-muted-foreground">
        {outcome
          ? t("decisionTraining.drawer.context.resolved", {
              defaultValue: "Resolved · {{outcome}}",
              outcome: decisionOutcomeLabel(t, outcome),
            })
          : t("decisionTraining.drawer.context.pending", {
              defaultValue: "Decision pending — cutoff will be now",
            })}
      </p>
    </section>
  );
}

/**
 * Read-only preview of the captured snapshot. Shared by the create state (from
 * the preview endpoint) and the saved state (from the persisted example). In the
 * saved state it renders a visible read-only banner and per-section view links.
 */
function SnapshotPreview({
  heading,
  snapshot,
  cutoffAt,
  loading = false,
  error = null,
  readOnly = false,
  exampleId,
}: {
  heading: string;
  snapshot: DecisionTrainingExample["snapshot"] | null;
  cutoffAt: string | null;
  loading?: boolean;
  error?: string | null;
  readOnly?: boolean;
  exampleId?: string;
}) {
  const { t } = useTranslation();
  return (
    <section className="space-y-2" data-testid="training-snapshot">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-foreground">{heading}</span>
        {readOnly && (
          <span className="inline-flex items-center gap-1 text-(length:--text-nano) uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
            <Lock className="size-3" />{" "}
            {t("decisionTraining.drawer.snapshot.readOnly")}
          </span>
        )}
      </div>

      {loading && (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />{" "}
          {t("decisionTraining.capturing")}
        </p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}

      {snapshot && (
        <div className="divide-y divide-border rounded-md border border-border">
          <SnapshotRow
            icon={<Clock className="size-4" />}
            label={t("decisionTraining.drawer.snapshot.cutoff")}
            value={cutoffAt ? new Date(cutoffAt).toLocaleString() : "now"}
            href={exampleId ? decisionTrainingHref(exampleId) : undefined}
          />
          <SnapshotRow
            icon={<MessageSquare className="size-4" />}
            label={t("decisionTraining.drawer.snapshot.comments")}
            value={
              snapshot.cutoff.commentCount === 0
                ? "None before cutoff"
                : `${snapshot.cutoff.commentCount} · last ${snapshot.cutoff.lastCommentId?.slice(0, 8) ?? "—"}`
            }
            href={exampleId ? decisionTrainingHref(exampleId) : undefined}
          />
          <SnapshotRow
            icon={<Play className="size-4" />}
            label={t("decisionTraining.drawer.snapshot.runs")}
            value={
              snapshot.runs.length === 0
                ? "None before cutoff"
                : `${snapshot.runs.length} before cutoff`
            }
            href={exampleId ? decisionTrainingHref(exampleId) : undefined}
          />
          <SnapshotRow
            icon={<GitCommitHorizontal className="size-4" />}
            label={t("decisionTraining.drawer.snapshot.commit")}
            value={
              snapshot.code.commitSha
                ? `${snapshot.code.commitSha.slice(0, 10)} · ${codeResolutionLabel(snapshot.code.resolution)}`
                : codeResolutionLabel(snapshot.code.resolution)
            }
            href={exampleId ? decisionTrainingHref(exampleId) : undefined}
          />
        </div>
      )}
    </section>
  );
}

function SnapshotRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  href?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 px-3 py-2">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-(length:--text-nano) uppercase tracking-(--tracking-eyebrow) text-muted-foreground">
          {label}
        </p>
        <p className="truncate text-sm text-foreground">{value}</p>
      </div>
      {href && (
        <Link
          to={href}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <FileText className="size-3.5" /> {t("decisionTraining.view")}
        </Link>
      )}
    </div>
  );
}
