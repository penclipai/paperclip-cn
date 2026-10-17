import { translateInstant } from "@/i18n";
import { useTranslation } from "react-i18next";
import { Fragment } from "react";
import {
  ISSUE_THREAD_INTERACTION_KINDS,
  normalizeIssueThreadInteractionResolverPolicy,
  type InteractionResolverGovernance,
  type IssueThreadInteractionCanonicalResolverPolicy,
  type IssueThreadInteractionKind,
  type IssueThreadInteractionResolverPolicy,
} from "@penclipai/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const INTERACTION_KIND_LABEL_KEYS: Record<IssueThreadInteractionKind, string> = {
  suggest_tasks: "interactionGovernance.kind.suggestTasks",
  ask_user_questions: "interactionGovernance.kind.askUserQuestions",
  request_confirmation: "interactionGovernance.kind.confirmations",
  request_checkbox_confirmation: "interactionGovernance.kind.checkboxConfirmations",
  request_item_verdicts: "interactionGovernance.kind.itemVerdicts",
  connection_intent: "interactionGovernance.kind.connectionRequests",
};

function interactionKindLabel(kind: IssueThreadInteractionKind): string {
  return translateInstant(INTERACTION_KIND_LABEL_KEYS[kind]);
}

/**
 * Sentinel for "no override" — Radix Select disallows empty-string item values.
 * Under the open-default contract (PAP-17280) an absent override *is* the open
 * audience, so this sentinel is what a company sees selected until it
 * deliberately narrows a kind.
 */
export const GOVERNANCE_UNSET = "default";
export type GovernanceSelectValue = typeof GOVERNANCE_UNSET | IssueThreadInteractionResolverPolicy;

export type GovernanceField = "defaultPolicy" | "cap";

/**
 * Only *narrowing* policies are offered. `anyone` is the product default, so
 * requesting it as a default override is a no-op, and capping at `anyone` cannot
 * narrow anything — both collapse into the unset sentinel, which is presented as
 * the visible default.
 */
const NARROWING_POLICIES: readonly IssueThreadInteractionCanonicalResolverPolicy[] = [
  "not_creator",
  "human_only",
];

const UNSET_LABEL_KEYS: Record<GovernanceField, string> = {
  defaultPolicy: "interactionGovernance.unset.defaultPolicy",
  cap: "interactionGovernance.unset.cap",
};

const UNSET_EFFECT_KEYS: Record<GovernanceField, string> = {
  defaultPolicy: "interactionGovernance.effect.openDefault",
  cap: "interactionGovernance.effect.noCap",
};

const DEFAULT_POLICY_EFFECTS: Record<IssueThreadInteractionCanonicalResolverPolicy, string> = {
  anyone: UNSET_EFFECT_KEYS.defaultPolicy,
  not_creator: "interactionGovernance.effect.notCreatorDefault",
  human_only: "interactionGovernance.effect.humanOnlyDefault",
};

const CAP_EFFECTS: Record<IssueThreadInteractionCanonicalResolverPolicy, string> = {
  anyone: UNSET_EFFECT_KEYS.cap,
  not_creator: "interactionGovernance.effect.notCreatorCap",
  human_only: "interactionGovernance.effect.humanOnlyCap",
};

const RESOLVER_POLICY_LABEL_KEYS: Record<IssueThreadInteractionCanonicalResolverPolicy, string> = {
  anyone: "Anyone",
  not_creator: "interactionResolver.not_creator",
  human_only: "interactionResolver.human_only",
};

function governanceOptions(field: GovernanceField): {
  value: GovernanceSelectValue;
  label: string;
  effect: string;
}[] {
  const effects = field === "cap" ? CAP_EFFECTS : DEFAULT_POLICY_EFFECTS;
  return [
    { value: GOVERNANCE_UNSET, label: translateInstant(UNSET_LABEL_KEYS[field]), effect: translateInstant(UNSET_EFFECT_KEYS[field]) },
    ...NARROWING_POLICIES.map((policy) => ({
      value: policy as GovernanceSelectValue,
      label: translateInstant(RESOLVER_POLICY_LABEL_KEYS[policy]),
      effect: translateInstant(effects[policy]),
    })),
  ];
}

/**
 * The label a *closed* trigger must show. Derived from the value rather than
 * looked up in the option list so an out-of-list value (a raw `anyone`, say)
 * still renders a complete, truthful label instead of falling back to a lie.
 */
export function governanceValueLabel(field: GovernanceField, value: GovernanceSelectValue): string {
  return translateInstant(value === GOVERNANCE_UNSET ? UNSET_LABEL_KEYS[field] : RESOLVER_POLICY_LABEL_KEYS[normalizeIssueThreadInteractionResolverPolicy(value)]);
}

/**
 * Map a persisted override onto a select value. A stored `anyone` — including
 * the deprecated `board_or_agents` alias — is the open default, so it shows as
 * the unset sentinel rather than as a narrowing override.
 */
export function toGovernanceSelectValue(
  policy: IssueThreadInteractionResolverPolicy | undefined,
): GovernanceSelectValue {
  if (!policy) return GOVERNANCE_UNSET;
  const canonical = normalizeIssueThreadInteractionResolverPolicy(policy);
  return canonical === "anyone" ? GOVERNANCE_UNSET : canonical;
}

/**
 * Apply a single (kind, field) change to a governance map immutably, pruning
 * empty entries so the persisted object stays sparse (only real overrides).
 */
export function applyGovernanceChange(
  current: InteractionResolverGovernance,
  kind: IssueThreadInteractionKind,
  field: GovernanceField,
  value: GovernanceSelectValue,
): InteractionResolverGovernance {
  const next: InteractionResolverGovernance = { ...current };
  const entry = { ...(next[kind] ?? {}) };
  if (value === GOVERNANCE_UNSET) {
    delete entry[field];
  } else {
    entry[field] = value;
  }
  if (entry.defaultPolicy === undefined && entry.cap === undefined) {
    delete next[kind];
  } else {
    next[kind] = entry;
  }
  return next;
}

function GovernanceSelect({
  field,
  value,
  onChange,
  disabled,
  testId,
  ariaLabel,
  mobileLabel,
}: {
  field: GovernanceField;
  value: GovernanceSelectValue;
  onChange: (value: GovernanceSelectValue) => void;
  disabled?: boolean;
  testId?: string;
  ariaLabel: string;
  mobileLabel: string;
}) {
  const options = governanceOptions(field);
  return (
    <div className="min-w-0">
      {/*
       * Below `sm` the governance grid collapses to a single column (see the
       * grid classes on the panel), detaching each select from its column
       * header. Surface a mobile-only inline label so the control stays
       * self-describing for sighted users, and always carry `aria-label` for
       * screen-reader pairing. WCAG 2.1 SC 1.4.10 (Reflow) — design review R2.
       */}
      <span className="mb-1 block text-xs font-medium text-muted-foreground uppercase tracking-wide sm:hidden">
        {mobileLabel}
      </span>
      <Select value={value} onValueChange={(v) => onChange(v as GovernanceSelectValue)} disabled={disabled}>
        <SelectTrigger
          size="sm"
          aria-label={ariaLabel}
          // 208px is sized for the longest label the control can hold —
          // `Anyone except creator` needs ~150px of text room, and 170px only
          // left 122px after padding, gap and chevron, so it clipped even once
          // the effect sentence was gone (PAP-17297).
          className="w-full min-w-0 text-xs sm:w-(--sz-208px)"
          data-testid={testId}
        >
          {/*
           * Explicit children, not the default `<SelectValue />`. Radix portals
           * the selected item's *whole* subtree into an empty value node, which
           * dragged each option's effect sentence into the closed trigger and
           * clipped the selected label (desktop truncated the prose, mobile cut
           * `Anyone (default)` mid-label — PAP-17293/PAP-17297). Passing children
           * sets `valueNodeHasChildren`, which suppresses that portal, so the
           * trigger shows exactly the label and nothing else.
           */}
          <SelectValue>{governanceValueLabel(field, value)}</SelectValue>
        </SelectTrigger>
        {/*
         * Cap the option list so the effect sentences wrap instead of stretching
         * the popover past a ~390px viewport (WCAG 2.1 SC 1.4.10 Reflow).
         */}
        <SelectContent className="max-w-(--sz-280px) sm:max-w-(--sz-360px)">
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value}
              // Keyboard typeahead matches on `textValue` when given; without it
              // Radix would match against the effect prose too.
              textValue={option.label}
              className="text-xs"
            >
              {/*
               * Effect preview lives inside the option so the consequence of a
               * narrowing choice is legible at the moment of choosing, not only
               * after saving (PAP-17280).
               */}
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{option.label}</span>
                <span className="text-(length:--text-micro) text-muted-foreground">
                  {option.effect}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/**
 * Company-level interaction governance: the per-kind default audience and cap.
 *
 * The open default is the headline — interactions are resolvable by anyone in
 * the company unless a row here narrows them — so the panel only offers
 * narrowing choices and never presents an unrestricted card as board-required
 * (PAP-17280, contract in `doc/SPEC-implementation.md` §9.8.1).
 */
export function InteractionGovernancePanel({
  governance,
  onChange,
  isPending,
  errorMessage,
}: {
  governance: InteractionResolverGovernance;
  onChange: (kind: IssueThreadInteractionKind, field: GovernanceField, value: GovernanceSelectValue) => void;
  isPending?: boolean;
  errorMessage?: string | null;
}) {
  useTranslation();
  return (
    <div className="space-y-4" data-testid="company-settings-interaction-governance-section">
      <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {translateInstant("interactionGovernance.title")}</div>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {translateInstant("Thread interactions are open by default:")}{" "}
          <span className="font-medium text-foreground">{translateInstant("Anyone")}</span> {translateInstant("in the organization — the board or any agent, including the one that asked — can respond. Narrow a kind only when you need to.")}{" "}
          <span className="font-medium text-foreground">{translateInstant("interactionGovernance.column.defaultPolicy")}</span> {translateInstant("is the audience new cards get when the requester does not ask for one;")}{" "}
          <span className="font-medium text-foreground">{translateInstant("interactionGovernance.column.cap")}</span> {translateInstant("narrows every request of that kind and can never widen one. Tool-approval confirmations always stay")}{" "}
          <span className="font-medium text-foreground">{translateInstant("interactionResolver.human_only")}</span>{translateInstant(".")}</p>
        {/*
         * Responsive: below `sm` the row collapses to a single column so the
         * two 170px selects never force horizontal overflow on a ~390px
         * viewport (WCAG 2.1 SC 1.4.10 Reflow — design review R2). Each kind
         * then stacks as: label → Default policy → Cap, each full-width with
         * its own inline label. At `sm`+ it restores the aligned 3-col grid.
         */}
        <div className="grid grid-cols-1 gap-y-4 sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-x-4 sm:gap-y-2.5">
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            {translateInstant("interactionGovernance.column.kind")}</div>
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            {translateInstant("interactionGovernance.column.defaultPolicy")}</div>
          <div className="hidden text-xs font-medium text-muted-foreground uppercase tracking-wide sm:block">
            {translateInstant("interactionGovernance.column.cap")}</div>
          {ISSUE_THREAD_INTERACTION_KINDS.map((kind) => {
            const entry = governance[kind] ?? {};
            const kindLabel = interactionKindLabel(kind);
            return (
              <Fragment key={kind}>
                <div className="text-sm font-medium sm:font-normal">{kindLabel}</div>
                <GovernanceSelect
                  field="defaultPolicy"
                  testId={`governance-${kind}-default`}
                  ariaLabel={translateInstant("companySettings.governance.defaultPolicyAria", { kind: kindLabel })}
                  mobileLabel={translateInstant("interactionGovernance.column.defaultPolicy")}
                  value={toGovernanceSelectValue(entry.defaultPolicy)}
                  disabled={isPending}
                  onChange={(v) => onChange(kind, "defaultPolicy", v)}
                />
                <GovernanceSelect
                  field="cap"
                  testId={`governance-${kind}-cap`}
                  ariaLabel={translateInstant("companySettings.governance.capAria", { kind: kindLabel })}
                  mobileLabel={translateInstant("interactionGovernance.column.cap")}
                  value={toGovernanceSelectValue(entry.cap)}
                  disabled={isPending}
                  onChange={(v) => onChange(kind, "cap", v)}
                />
              </Fragment>
            );
          })}
        </div>
        {errorMessage ? (
          <span className="text-xs text-destructive">{errorMessage}</span>
        ) : null}
      </div>
    </div>
  );
}
