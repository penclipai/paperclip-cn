import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Link } from "@/lib/router";
import { ArrowLeft, Check, Circle, CircleAlert, Loader2 } from "lucide-react";
import { AdapterMark } from "../AdapterMark";
import { AgentSetupPrompt } from "../AgentSetupPrompt";
import { Button } from "../ui/button";
import { DialogDescription, DialogTitle } from "../ui/dialog";
import { cn } from "@/lib/utils";

export type ExternalAgentPreset = "dot" | "hermes" | "other";
export type DotConnectionState = {
  phase: "waiting" | "connected" | "subscribed" | "testing" | "finishing" | "ready";
  problem?: "event_timeout" | "prompt_unavailable" | "offline" | "agent_unavailable";
};

const presets = [
  { id: "dot", name: "Dot", adapter: "openai_dot", descriptionKey: "newAgent.externalPresetDotDescription" },
  { id: "hermes", name: "Hermes", adapter: "hermes_gateway", descriptionKey: "newAgent.externalPresetHermesDescription" },
  { id: "other", name: "Other", adapter: "http", descriptionKey: "newAgent.externalPresetOtherDescription" },
] as const;

export function ExternalAgentPresetPicker({ onSelect, dotDisabledReason }: { onSelect: (preset: ExternalAgentPreset) => void; dotDisabledReason?: string }) {
  const { t } = useTranslation();
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
    {presets.map(preset => <button
      key={preset.id}
      type="button"
      onClick={() => onSelect(preset.id)}
      disabled={preset.id === "dot" && !!dotDisabledReason}
      title={preset.id === "dot" ? dotDisabledReason : undefined}
      className="flex aspect-square flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card px-3 py-4 text-center transition-colors disabled:opacity-50 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <AdapterMark type={preset.adapter} className="size-8" />
      <span className="text-sm font-medium">{preset.id === "other" ? t("newAgent.externalPresetOther") : preset.name}</span>
      <span className="sr-only">{t(preset.descriptionKey)}</span>
    </button>)}
  </div>;
}

const checks = [
  { titleKey: "newAgent.dotCheckConnectedTitle", descriptionKey: "newAgent.dotCheckConnectedDescription" },
  { titleKey: "newAgent.dotCheckUpdatesTitle", descriptionKey: "newAgent.dotCheckUpdatesDescription" },
  { titleKey: "newAgent.dotCheckTestTitle", descriptionKey: "newAgent.dotCheckTestDescription" },
];

/** Controlled by server evidence in the invite controller, never by copying a prompt. */
export function DotConnectionChecks({ state }: { state: DotConnectionState }) {
  const { t } = useTranslation();
  const completed = { waiting: 0, connected: 1, subscribed: 2, testing: 2, finishing: 3, ready: 3 }[state.phase];
  const message = state.problem === "agent_unavailable" ? t("newAgent.dotStatusAgentUnavailable")
    : state.problem === "offline" ? t("newAgent.dotStatusOffline")
    : state.problem === "prompt_unavailable" ? t("newAgent.dotStatusPromptUnavailable")
    : state.problem === "event_timeout" ? t("newAgent.dotStatusEventTimeout")
    : state.phase === "finishing" ? t("newAgent.dotStatusFinishing")
    : state.phase === "ready" ? t("newAgent.dotStatusReady")
    : state.phase === "waiting" ? t("newAgent.dotStatusWaiting")
    : state.phase === "connected" ? t("newAgent.dotStatusConnected")
    : t("newAgent.dotStatusTesting");
  return <section aria-label={t("newAgent.dotConnectionChecks")} className="space-y-4">
    <ol className="space-y-4">
      {checks.map((check, index) => {
        const done = index < completed;
        const failed = index === completed && state.problem === "event_timeout";
        const active = index === completed && !state.problem;
        const Icon = done ? Check : failed ? CircleAlert : active ? Loader2 : Circle;
        return <li key={check.titleKey} className="flex items-start gap-3" aria-current={active ? "step" : undefined}>
          <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-full", done ? "bg-accent text-foreground" : failed ? "text-destructive" : "text-muted-foreground")}>
            <Icon className={cn("size-4", active && "animate-spin motion-reduce:animate-none")} />
          </span>
          <div className="min-w-0 pt-0.5">
            <p className={cn("text-sm", done || active || failed ? "font-medium" : "text-muted-foreground")}>
              {t(check.titleKey)}<span className="sr-only">{done ? t("newAgent.dotCheckComplete") : failed ? t("newAgent.dotCheckNeedsAttention") : active ? t("newAgent.dotCheckInProgress") : t("newAgent.dotCheckWaiting")}</span>
            </p>
            {done && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{t(check.descriptionKey)}</p>}
          </div>
        </li>;
      })}
    </ol>
    <p role={state.problem && state.problem !== "prompt_unavailable" ? "alert" : "status"} aria-live="polite" className={cn("text-sm leading-relaxed", state.problem && state.problem !== "prompt_unavailable" ? "text-destructive" : "text-muted-foreground")}>{message}</p>
  </section>;
}

/** Shared presentation for the invitation flow. The caller owns invitations and watching. */
export function ExternalAgentInviteContent({
  preset, prompt, companyName, connection, onSelect, onBack, onClose, onCopied, onRetry, onNewPrompt,
  dotDisabledReason, busy = false, error, approvalHref,
}: {
  dotDisabledReason?: string;
  busy?: boolean;
  error?: string;
  approvalHref?: string;
  preset: ExternalAgentPreset | null;
  prompt: string;
  companyName: string;
  connection: DotConnectionState;
  onSelect: (preset: ExternalAgentPreset) => void;
  onBack: () => void;
  onClose: () => void;
  onCopied: () => void;
  onRetry: () => void;
  onNewPrompt: () => void;
}) {
  const { t } = useTranslation();
  const provider = presets.find(item => item.id === preset);
  const dot = preset === "dot";
  const ready = dot && connection.phase === "ready" && !connection.problem;
  const connecting = dot && connection.phase !== "waiting";
  const progressLabel = connection.problem === "agent_unavailable" ? t("newAgent.dotProgressAgentUnavailable")
    : connection.problem === "offline" ? t("newAgent.dotProgressUpdatesPaused")
    : connection.problem === "event_timeout" ? t("newAgent.dotProgressNeedsAttention")
    : connection.phase === "finishing" ? t("newAgent.dotProgressFinishing")
    : connection.phase === "connected" ? t("newAgent.dotProgressConnecting") : t("newAgent.dotProgressConfirming");
  return <>
    <div className="min-h-0 space-y-6 overflow-y-auto px-6 pb-6 pt-8 sm:px-8">
      <div className="space-y-3 pr-5">
        {provider && <AdapterMark type={provider.adapter} className="size-10" />}
        <div className="space-y-2">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {!provider ? t("newAgent.inviteExternalAgent") : dot ? ready ? t("newAgent.dotConnectedTitle") : t("newAgent.dotConnectTitle") : preset === "hermes" ? t("newAgent.inviteHermesAgent") : t("newAgent.inviteAgent")}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {!provider ? t("newAgent.externalInviteDescription", { companyName })
              : ready ? t("newAgent.dotReadyDescription", { companyName })
              : connection.problem === "agent_unavailable" ? t("newAgent.dotAgentUnavailableDescription")
              : connection.phase === "finishing" ? t("newAgent.dotFinishingDescription")
              : connecting ? t("newAgent.dotConnectingDescription")
              : dot ? t("newAgent.dotPromptDescription")
              : t("newAgent.externalPromptDescription")}
          </DialogDescription>
        </div>
      </div>
      {error && <div role="alert" className="space-y-3 text-sm text-destructive"><p>{error}</p><Button variant="outline" disabled={busy} onClick={onRetry}>{translateInstant("Try again")}</Button></div>}
      {!provider ? <><ExternalAgentPresetPicker onSelect={onSelect} dotDisabledReason={dotDisabledReason} />
        {dotDisabledReason && <p className="text-sm text-muted-foreground">{dotDisabledReason}</p>}</>
        : approvalHref ? <p className="text-sm text-muted-foreground">{translateInstant("An organization admin needs to approve this agent before Dot can connect. This page will update after approval.")}</p>
        : busy && !prompt && connection.phase === "waiting" ? <p role="status" className="text-sm text-muted-foreground">{translateInstant("Preparing your invitation…")}</p> : dot ? <>
        <div className="border-t pt-6"><DotConnectionChecks state={connection} />
          {connection.phase === "waiting" && <p className="mt-4 text-xs text-muted-foreground">{translateInstant("Dot uses your OpenAI account. Provider usage and cost aren’t reported to Paperclip.")}</p>}</div>
        {connection.problem === "event_timeout" && <Button variant="outline" disabled={busy} onClick={onRetry}>{translateInstant("Retry test event")}</Button>}
        {connection.problem === "offline" && <Button variant="outline" disabled={busy} onClick={onRetry}>{translateInstant("Reconnect updates")}</Button>}
      </> : <p className="text-sm leading-relaxed text-muted-foreground">{t("newAgent.externalInvitationBody", { companyName })}</p>}
    </div>
    <div className="flex items-center justify-between gap-3 border-t px-6 py-4 sm:px-8">
      <Button variant="ghost" onClick={provider ? onBack : onClose}>
        {provider && <ArrowLeft className="size-4" />}{provider ? t("newAgent.back") : t("common.cancel")}
      </Button>
      {provider && (approvalHref ? <Button asChild><Link to={approvalHref} onClick={onClose}>{translateInstant("Review approval")}</Link></Button>
        : ready ? <Button onClick={onClose}>{translateInstant("Done")}</Button>
        : connecting ? <Button disabled aria-live="polite">
          {!connection.problem && <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
          {progressLabel}
        </Button>
        : dot && connection.problem === "prompt_unavailable" ? <Button disabled={busy} onClick={onNewPrompt}>{translateInstant("Create a new prompt")}</Button>
        : !prompt || busy ? <Button disabled>{busy ? t("newAgent.externalPreparing") : t("newAgent.dotWaiting")}</Button>
        : <AgentSetupPrompt
          key={preset}
          prompt={prompt}
          label={dot ? t("newAgent.copySetupPrompt") : t("newAgent.copyInvitationPrompt")}
          title={dot ? t("newAgent.dotConnectTitle") : t("newAgent.inviteAgent")}
          description={dot ? t("newAgent.dotSetupPromptDescription") : t("newAgent.externalSetupPromptDescription")}
          agent={dot ? { name: "Dot", src: "/brands/adapters/openai-dot.svg" } : undefined}
          align="end"
          className="min-w-0 shrink"
          onCopied={onCopied}
        />)}
    </div>
  </>;
}
