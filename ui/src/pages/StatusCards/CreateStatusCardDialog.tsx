import { useTranslation } from "react-i18next";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { defaultStatusCardRefreshPolicy } from "@penclipai/shared";
import { Loader2 } from "lucide-react";

import { statusCardsApi } from "@/api/statusCards";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { InlineBanner } from "@/components/InlineBanner";
import { queryKeys } from "@/lib/queryKeys";
import { SummarizerAgentSelect } from "./SummarizerAgentSelect";

const EXAMPLES = [
  "issues about evals",
  "everything blocked this week",
  "is feature X live? if not, the exact next actions to ship it",
];

export function CreateStatusCardDialog({
  companyId,
  open,
  onOpenChange,
}: {
  companyId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  // "" → the built-in Summarizer; otherwise the id of the override agent.
  const [agentId, setAgentId] = useState("");
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setPrompt("");
    setAgentId("");
    setError(null);
  }

  function close() {
    onOpenChange(false);
    // Delay reset so the closing animation does not flash cleared fields.
    window.setTimeout(reset, 200);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      statusCardsApi.create(companyId, {
        interestPrompt: prompt.trim(),
        titlePinned: false,
        agentId: agentId || null,
        refreshPolicy: defaultStatusCardRefreshPolicy,
      }),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.statusCards.list(companyId, false),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.statusCards.list(companyId, true),
        }),
      ]);
      close();
    },
    onError: (err) =>
      setError(
        err instanceof Error ? err.message : "Could not create the card.",
      ),
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("statusCards.create.newCard")}</DialogTitle>
          <DialogDescription>
            {t("statusCards.create.description")}
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <InlineBanner tone="danger" title={t("statusCards.create.failed")}>
            {error}
          </InlineBanner>
        ) : null}

        <div className="space-y-3">
          <label
            htmlFor="status-card-prompt"
            className="block pb-1 text-sm font-semibold"
          >
            {t("statusCards.create.promptLabel")}
          </label>
          <Textarea
            id="status-card-prompt"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            autoFocus
            placeholder={t("statusCards.create.promptPlaceholder")}
            className="text-sm"
          />
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">
              {t("Examples")}
            </span>
            {EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => setPrompt(example)}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/40"
              >
                {example}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-semibold">
            {t("caseComponents.activity.actors.agent")}
          </label>
          <SummarizerAgentSelect
            companyId={companyId}
            value={agentId}
            onChange={setAgentId}
            enabled={open}
          />
          <p className="text-xs text-muted-foreground">
            {t("statusCards.create.agentHint")}
          </p>
        </div>

        <DialogFooter>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={close}
              disabled={createMutation.isPending}
            >
              {t("apps.gateways.newGateway.cancel")}
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={prompt.trim().length === 0 || createMutation.isPending}
            >
              {createMutation.isPending ? (
                <Loader2 className="animate-spin" />
              ) : null}
              {t("statusCards.create.submit")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
