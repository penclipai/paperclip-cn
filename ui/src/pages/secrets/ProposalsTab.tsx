import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { useId, useMemo, useState } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Inbox, Loader2 } from "lucide-react";
import type {
  CompanySecretProviderConfig,
  SecretProposalStatus,
  SecretProposalView,
} from "@penclipai/shared";
import { AgentAvatar } from "@/components/AgentAvatar";
import { QueryErrorState, useQueryView } from "@/components/QueryView";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/select";
import { secretsApi } from "../../api/secrets";
import { queryKeys } from "../../lib/queryKeys";
import { deliveryModeForConfigPath } from "../../lib/secret-delivery";
import { cn, relativeTime } from "../../lib/utils";
import { EmptyState } from "../../components/EmptyState";
import {
  FingerprintChip,
  ProposalJustification,
  bindingEnvKey,
  bindingSecretLabel,
  useProposalDecision,
} from "./proposal-review";

const DECIDED_STATUSES = ["approved", "rejected", "expired"] as const satisfies readonly SecretProposalStatus[];
const DECIDED_LIMIT = 10;

/** ISO expiry → "Expires in 12d" / "Expires in 5h" / "Expired". */
function expiryLabel(expiresAt: string): { text: string; urgent: boolean } | null {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return { text: translateInstant("secrets.proposals.expired", { defaultValue: "Expired" }), urgent: true };
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return { text: translateInstant("secrets.proposals.expiresInHours", { hours, defaultValue: "Expires in {{hours}}h" }), urgent: true };
  const days = Math.floor(hours / 24);
  return { text: translateInstant("secrets.proposals.expiresInDays", { days, defaultValue: "Expires in {{days}}d" }), urgent: days <= 2 };
}

/** Trim a typed secret name and drop stray leading/trailing slashes. */
function normalizeSecretName(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, "");
}

/** "<Agent> wants to save a new secret, <Name>" and its access equivalents. */
function RequestSentence({ proposal }: { proposal: SecretProposalView }) {
  const proposer = <span className="font-medium">{proposal.proposedBy.name}</span>;
  if (proposal.kind === "secret") {
    return (
      <>
        {translateInstant("secrets.proposals.wantsToSaveSecretPrefix", { agent: proposal.proposedBy.name, defaultValue: "{{agent}} wants to save a new secret," })}{" "}
        <span className="break-all font-medium">{proposal.proposedName ?? translateInstant("secrets.proposals.unnamed", { defaultValue: "unnamed" })}</span>
      </>
    );
  }
  const secret = <span className="break-all font-medium">{bindingSecretLabel(proposal).name}</span>;
  if (proposal.target && proposal.target.id !== proposal.proposedBy.id) {
    return (
      <>
        {proposer} {translateInstant("secrets.proposals.wantsTargetToUse", { defaultValue: "wants" })} <span className="font-medium">{proposal.target.name}</span> {translateInstant("secrets.proposals.toUse", { defaultValue: "to use" })} {secret}
      </>
    );
  }
  return (
    <>
      {proposer} {translateInstant("secrets.proposals.wantsToUse", { defaultValue: "wants to use" })} {secret}
    </>
  );
}

/** One line saying how an approved secret would reach the agent. */
function DeliveryLine({ proposal }: { proposal: SecretProposalView }) {
  const mode = deliveryModeForConfigPath(proposal.configPath);
  const alias = bindingEnvKey(proposal);
  const code = <code className="font-mono text-foreground">{alias}</code>;
  const agent = proposal.target?.name ?? translateInstant("secrets.proposals.theAgent", { defaultValue: "the agent" });
  return (
    <p className="text-xs text-muted-foreground">
      {mode === "env" ? (
        <>
          {translateInstant("secrets.proposals.deliveryEnvPrefix", { agent, defaultValue: "It would be available in {{agent}}’s runs as the environment variable" })} {code}.
        </>
      ) : mode === "api" ? (
        <>
          {translateInstant("secrets.proposals.deliveryApiPrefix", { agent, defaultValue: "{{agent}} could ask for it during a run as" })} {code}. {translateInstant("secrets.proposals.deliveryApiSuffix", { defaultValue: "It is never written to the environment." })}
        </>
      ) : (
        <>{translateInstant("secrets.proposals.deliverySettings", { agent, defaultValue: "It would be provided through {{agent}}’s settings." })}</>
      )}{" "}
      {translateInstant("secrets.proposals.accessGrantedWithYourPermissions", { defaultValue: "Access is granted with your permissions." })}
    </p>
  );
}

function PendingProposal({
  proposal,
  companyId,
  vaults,
  readAs,
}: {
  proposal: SecretProposalView;
  companyId: string;
  /** Vaults a new secret can be stored in. */
  vaults: CompanySecretProviderConfig[];
  /** Environment variable names that pending access requests would expose this new secret as. */
  readAs: string[];
}) {
  useTranslation();
  const fieldId = useId();
  const isSecret = proposal.kind === "secret";
  const canDecide = proposal.viewerCanApprove;
  const defaultVaultId = vaults.find((vault) => vault.isDefault)?.id ?? "";

  const [name, setName] = useState(proposal.proposedName ?? "");
  const [description, setDescription] = useState(proposal.proposedDescription ?? "");
  const [editingDescription, setEditingDescription] = useState(Boolean(proposal.proposedDescription));
  // "" stores the secret in the default vault.
  const [vaultId, setVaultId] = useState(defaultVaultId);
  // Access to a secret that is itself still waiting can only be approved together with it.
  const needsSecret = Boolean(proposal.secretProposalId);
  const [alsoSaveSecret, setAlsoSaveSecret] = useState(needsSecret);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");

  const decision = useProposalDecision(companyId);
  const expiry = expiryLabel(proposal.expiresAt);
  const secretName = normalizeSecretName(name);
  const secretLabel = bindingSecretLabel(proposal).name;

  const approve = () => {
    decision.clearError();
    if (isSecret) {
      decision.approve(proposal, {
        overrides: {
          name: secretName,
          description: description.trim() || null,
          providerConfigId: vaultId || null,
        },
      });
      return;
    }
    decision.approve(proposal, { cascade: alsoSaveSecret || undefined });
  };

  return (
    <li className="flex flex-col gap-3 px-3 py-4" data-testid={`proposal-${proposal.id}`}>
      <div className="flex items-start gap-3">
        <AgentAvatar agent={proposal.proposedBy} size={32} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-sm">
            <RequestSentence proposal={proposal} />
          </p>
          <p className="text-xs text-muted-foreground">
            {proposal.originIssue ? (
              <>
                {translateInstant("secrets.proposals.whileWorkingOn", { defaultValue: "While working on" })}{" "}
                <Link
                  to={`/issues/${proposal.originIssue.key}`}
                  className="hover:text-foreground hover:underline"
                >
                  “{proposal.originIssue.title}”
                </Link>
                {" · "}
              </>
            ) : null}
            {relativeTime(proposal.createdAt)}
            {expiry ? (
              <>
                {" · "}
                <span className={cn(expiry.urgent && "font-medium text-foreground")}>{expiry.text}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <ProposalJustification variant="quote" justification={proposal.justification} />

      {isSecret ? (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <label
              htmlFor={`${fieldId}-name`}
              className="flex min-w-48 flex-1 flex-col gap-1.5 text-sm font-medium"
            >
              {translateInstant("common.name", { defaultValue: "Name" })}
              <Input
                id={`${fieldId}-name`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={!canDecide || decision.isBusy}
                aria-invalid={!secretName}
                className="font-mono"
              />
            </label>
            {vaults.length + (defaultVaultId ? 0 : 1) > 1 ? (
              <label
                htmlFor={`${fieldId}-vault`}
                className="flex flex-col gap-1.5 text-sm font-medium"
              >
                {translateInstant("secrets.proposals.storedIn", { defaultValue: "Stored in" })}
                <NativeSelect
                  id={`${fieldId}-vault`}
                  value={vaultId}
                  onChange={(event) => setVaultId(event.target.value)}
                  disabled={!canDecide || decision.isBusy}
                  className="font-normal"
                >
                  {defaultVaultId ? null : <option value="">Paperclip</option>}
                  {vaults.map((vault) => (
                    <option key={vault.id} value={vault.id}>
                      {vault.displayName}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ) : null}
          </div>

          {editingDescription ? (
            <label
              htmlFor={`${fieldId}-description`}
              className="flex flex-col gap-1.5 text-sm font-medium"
            >
              {translateInstant("common.description", { defaultValue: "Description" })}
              <Input
                id={`${fieldId}-description`}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                disabled={!canDecide || decision.isBusy}
                placeholder={translateInstant("common.optional", { defaultValue: "Optional" })}
                className="font-normal"
              />
            </label>
          ) : canDecide ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto self-start p-0 text-xs text-muted-foreground"
              onClick={() => setEditingDescription(true)}
            >
              {translateInstant("secrets.proposals.addDescription", { defaultValue: "Add a description" })}
            </Button>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {readAs.length > 0 ? (
              <>
                {translateInstant("secrets.proposals.agentsWillReadAs", { defaultValue: "Agents given access will read it as" })}{" "}
                {readAs.map((key, index) => (
                  <span key={key}>
                    {index > 0 ? ", " : null}
                    <code className="font-mono text-foreground">{key}</code>
                  </span>
                ))}
                .{" "}
              </>
            ) : null}
            {translateInstant("secrets.proposals.hiddenValueFingerprintLead", { defaultValue: "The value stays hidden and is saved exactly as the agent recorded it. Its fingerprint lets you confirm it with the agent:" })}{" "}
            <FingerprintChip
              fingerprint={proposal.valueFingerprintSha256}
              length={proposal.valueLength}
              className="align-middle text-foreground"
            />
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <DeliveryLine proposal={proposal} />
          {needsSecret ? (
            <label className="flex items-start gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={alsoSaveSecret}
                onCheckedChange={(checked) => setAlsoSaveSecret(checked === true)}
                disabled={!canDecide || decision.isBusy}
                aria-label={translateInstant("secrets.proposals.alsoSaveSecretAria", { defaultValue: "Also save the new secret" })}
              />
              <span>
                <span className="font-medium text-foreground">{secretLabel}</span>{" "}
                {translateInstant("secrets.proposals.newSecretSaveWithApprovalSuffix", { defaultValue: "is a new secret that hasn’t been saved yet. Save it as part of this approval. Access can’t be approved without it." })}
              </span>
            </label>
          ) : null}
        </div>
      )}

      {decision.error ? (
        <p className="text-xs text-destructive" role="alert">
          {decision.error}
        </p>
      ) : null}

      {!canDecide ? (
        <p className="text-sm text-muted-foreground">
          {isSecret
            ? translateInstant("secrets.proposals.onlyAdminsCanDecide", { defaultValue: "Only organization admins can approve or reject this." })
            : translateInstant("secrets.proposals.onlyAgentManagersCanDecide", { agent: proposal.target?.name ?? translateInstant("secrets.proposals.thisAgent", { defaultValue: "this agent" }), defaultValue: "Only people who can change {{agent}}’s settings can approve or reject this." })}
        </p>
      ) : rejecting ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!reason.trim()) return;
            decision.clearError();
            decision.reject(proposal, reason);
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={translateInstant("secrets.proposals.reasonForRejectingAria", { defaultValue: "Reason for rejecting" })}
              autoFocus
              required
              className="min-w-48 flex-1"
              placeholder={translateInstant("secrets.proposals.tellAgentWhy", { defaultValue: "Tell the agent why" })}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={decision.isBusy}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={decision.isBusy}
              onClick={() => {
                setRejecting(false);
                setReason("");
                decision.clearError();
              }}
            >
              {translateInstant("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              size="sm"
              disabled={decision.isBusy || !reason.trim()}
            >
              {decision.rejecting
                ? translateInstant("secrets.proposals.rejecting", { defaultValue: "Rejecting…" })
                : translateInstant("secrets.proposals.reject", { defaultValue: "Reject" })}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {translateInstant("secrets.proposals.reasonRequiredSentTo", { agent: proposal.proposedBy.name, defaultValue: "A reason is required. It is sent to {{agent}}." })}
            {isSecret ? ` ${translateInstant("secrets.proposals.accessRequestsRejectedToo", { defaultValue: "Requests to use this secret are rejected too." })}` : null}
          </p>
        </form>
      ) : (
        <div className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            size="sm"
            disabled={decision.isBusy}
            onClick={() => {
              decision.clearError();
              setRejecting(true);
            }}
          >
            {translateInstant("secrets.proposals.reject", { defaultValue: "Reject" })}
          </Button>
          <Button size="sm" disabled={decision.isBusy || (isSecret && !secretName)} onClick={approve}>
            {decision.approving
              ? translateInstant("secrets.proposals.approving", { defaultValue: "Approving…" })
              : isSecret
                ? translateInstant("secrets.proposals.approveAndSaveSecret", { defaultValue: "Approve and save secret" })
                : alsoSaveSecret
                  ? translateInstant("secrets.proposals.approveAccessAndSaveSecret", { defaultValue: "Approve access and save secret" })
                  : translateInstant("secrets.proposals.approveAccess", { defaultValue: "Approve access" })}
          </Button>
        </div>
      )}
    </li>
  );
}

function decidedLabel(proposal: SecretProposalView): string {
  const outcome =
    proposal.status === "approved"
      ? translateInstant("secrets.proposals.approved", { defaultValue: "Approved" })
      : proposal.status === "rejected"
        ? translateInstant("secrets.proposals.rejected", { defaultValue: "Rejected" })
        : translateInstant("secrets.proposals.expired", { defaultValue: "Expired" });
  const at = proposal.resolvedAt ?? proposal.createdAt;
  return `${outcome} · ${relativeTime(at)}`;
}

export function ProposalsTab({
  companyId,
  providerConfigs,
}: {
  companyId: string;
  providerConfigs: CompanySecretProviderConfig[];
}) {
  useTranslation();
  const proposalsQuery = useQuery({
    queryKey: queryKeys.secrets.proposals(companyId, "pending"),
    queryFn: () => secretsApi.listProposals(companyId, "pending"),
    enabled: Boolean(companyId),
  });
  const decidedQueries = useQueries({
    queries: DECIDED_STATUSES.map((status) => ({
      queryKey: [...queryKeys.secrets.proposals(companyId, status), "recent"] as const,
      // Ordered by decision time on the server, so the newest decisions are
      // in the page even when the request itself is old.
      queryFn: () => secretsApi.listProposals(companyId, status, { order: "resolved", limit: DECIDED_LIMIT }),
      enabled: Boolean(companyId),
    })),
  });

  const proposalsView = useQueryView(proposalsQuery);
  const proposals = proposalsQuery.data ?? EMPTY_PROPOSALS;

  // New secrets first, then access — an approver usually saves the secret
  // before (or alongside) the access requests that depend on it.
  const pending = useMemo(
    () =>
      [...proposals].sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === "secret" ? -1 : 1;
        return a.createdAt.localeCompare(b.createdAt);
      }),
    [proposals],
  );

  const decidedLoading = decidedQueries.some((query) => query.isPending);
  const decidedFailed = decidedQueries.some((query) => query.isError);
  const decided = decidedQueries
    .flatMap((query, index) =>
      (query.data ?? []).filter((row) => row.status === DECIDED_STATUSES[index]),
    )
    .sort((a, b) => (b.resolvedAt ?? b.createdAt).localeCompare(a.resolvedAt ?? a.createdAt))
    .slice(0, DECIDED_LIMIT);

  // A new secret can only be stored in an encrypted vault Paperclip manages.
  const vaults = useMemo(
    () =>
      providerConfigs.filter(
        (config) => config.provider === "local_encrypted" && config.status !== "disabled",
      ),
    [providerConfigs],
  );

  if (proposalsView.kind === "error") {
    return (
      <div className="py-4">
        <QueryErrorState
          error={proposalsQuery.error}
          action="load requests"
          onRetry={proposalsView.retry}
          retrying={proposalsView.isFetching}
        />
      </div>
    );
  }

  if (
    proposalsQuery.isPending ||
    proposalsView.kind === "reconnecting" ||
    (pending.length === 0 && decidedLoading)
  ) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {translateInstant("secrets.proposals.loadingRequests", { defaultValue: "Loading requests…" })}
      </div>
    );
  }

  if (pending.length === 0 && decided.length === 0 && !decidedFailed) {
    return (
      <EmptyState
        icon={Inbox}
        title={translateInstant("secrets.proposals.nothingToReviewTitle", { defaultValue: "Nothing to review" })}
        message={translateInstant("secrets.proposals.nothingToReviewMessage", { defaultValue: "When an agent asks to save a secret or to use one, the request appears here." })}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={translateInstant("secrets.proposals.waitingForDecisionAria", { defaultValue: "Waiting for a decision" })} className="flex flex-col gap-2">
        <p className="max-w-xl text-sm text-muted-foreground">
          {translateInstant("secrets.proposals.sectionDescription", { defaultValue: "Agents ask here before they save a secret or use one they don’t have. Nothing changes until you approve." })}
        </p>
        {pending.length > 0 ? (
          <ul className="divide-y divide-border border-y border-border">
            {pending.map((proposal) => (
              <PendingProposal
                key={proposal.id}
                proposal={proposal}
                companyId={companyId}
                vaults={vaults}
                readAs={
                  proposal.kind === "secret"
                    ? [
                        ...new Set(
                          pending
                            .filter(
                              (other) =>
                                other.secretProposalId === proposal.id &&
                                deliveryModeForConfigPath(other.configPath) === "env",
                            )
                            .map(bindingEnvKey)
                            .filter(Boolean),
                        ),
                      ]
                    : EMPTY_KEYS
                }
              />
            ))}
          </ul>
        ) : (
          <p className="border-y border-border px-3 py-4 text-sm text-muted-foreground">
            {translateInstant("secrets.proposals.caughtUp", { defaultValue: "You’re caught up. No requests are waiting." })}
          </p>
        )}
      </section>

      {decided.length > 0 || decidedFailed ? (
        <section aria-label={translateInstant("secrets.proposals.recentlyDecided", { defaultValue: "Recently decided" })} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">{translateInstant("secrets.proposals.recentlyDecided", { defaultValue: "Recently decided" })}</h2>
          {decided.length > 0 ? (
            <ul className="divide-y divide-border border-y border-border">
              {decided.map((proposal) => (
                <li
                  key={proposal.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-3 py-2.5 text-sm"
                >
                  <span className="min-w-0 text-muted-foreground">
                    <RequestSentence proposal={proposal} />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {decidedLabel(proposal)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {decidedFailed ? (
            <p className="text-xs text-muted-foreground">
              {translateInstant("secrets.proposals.earlierDecisionsLoadError", { defaultValue: "Some earlier decisions couldn’t be loaded. Reload the page to try again." })}
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

const EMPTY_PROPOSALS: SecretProposalView[] = [];
const EMPTY_KEYS: string[] = [];
