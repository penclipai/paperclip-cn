import { useTranslation } from "react-i18next";
import { translateInstant } from "@/i18n";
import { AlertTriangle } from "lucide-react";
import type { ToolProfileWithDetails } from "@penclipai/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ProfileActionDialogKind = "archive" | "delete" | "restore";

export function ProfileActionDialog({
  kind,
  profile,
  pending,
  onClose,
  onArchive,
  onRestore,
  onDelete,
}: {
  kind: ProfileActionDialogKind | null;
  profile: ToolProfileWithDetails | null;
  pending: boolean;
  onClose: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onDelete: () => void;
}) {
  useTranslation();
  if (!kind || !profile) return null;

  const defaultDeleteBlocked = kind === "delete" && profile.summary.isCompanyDefault;
  const copy = {
    archive: {
      title: translateInstant("tools.profiles.actions.archive.title"),
      body: `This profile stops applying to ${profile.summary.appliesToAgentCount} ${profile.summary.appliesToAgentCount === 1 ? "agent" : "agents"}. You can restore it later.`,
      confirm: translateInstant("Archive"),
      action: onArchive,
    },
    restore: {
      title: translateInstant("tools.profiles.actions.restore.title"),
      body: "This profile will be active again and can be assigned to agents.",
      confirm: translateInstant("Restore"),
      action: onRestore,
    },
    delete: {
      title: translateInstant("tools.profiles.actions.delete.title"),
      body: defaultDeleteBlocked
        ? "This profile is the organization default. Reassign the organization default to another profile before deleting it."
        : `This permanently deletes the profile and removes ${profile.summary.assignmentCount} ${profile.summary.assignmentCount === 1 ? "assignment" : "assignments"}.`,
      confirm: translateInstant("Delete"),
      action: onDelete,
    },
  }[kind];

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.body}</DialogDescription>
        </DialogHeader>
        {defaultDeleteBlocked ? (
          <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{translateInstant("Choose another access profile and make it the organization default first.")}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{translateInstant("tools.common.cancel")}</Button>
          <Button
            variant={kind === "delete" ? "destructive" : "default"}
            disabled={pending || defaultDeleteBlocked}
            onClick={copy.action}
          >
            {copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
