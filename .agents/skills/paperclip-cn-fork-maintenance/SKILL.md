---
name: paperclip-cn-fork-maintenance
description: Maintain the Paperclip CN fork's zh-CN localization, Windows/Electron health, external-adapter boundaries, and rebrand policy. Use for upstream sync or recovery, fork drift and i18n audits, platform/adapter reviews, PR handoff, and explicit merge-to-latest coordination.
---

# Paperclip CN Fork Maintenance

Keep the fork aligned with upstream structure while preserving only its intended long-lived differences.

## Commands

Use a short command first, followed by optional scope or lifecycle intent.

| Command | Purpose | Default completion boundary |
|---|---|---|
| `sync-fork` | Merge upstream and preserve fork contracts | verified PR created or updated |
| `sync-fork-review` | Review an already-merged sync branch | actionable PR-readiness findings |
| `sync-fork-fix` | Fix the latest sync review findings | fixes verified on the working branch |
| `sync-fork-pr` | Prepare, push, and open or update the sync PR | PR with verification evidence |
| `review-drift` | Classify fork-versus-upstream differences | keep, trim, and do-not-touch decisions |
| `audit-i18n` | Audit source and locale-catalog localization | findings or verified fixes |
| `audit-i18n-browser` | Review rendered routes and interactions in zh-CN | browser coverage record and findings |
| `audit-i18n-keys` | Snapshot or compare locale key definitions and usages | reproducible static audit output |
| `audit-windows` | Audit Windows command, path, and junction behavior | compatibility findings or verified fixes |
| `audit-electron` | Audit Electron packaging and isolation | packaging findings or verified fixes |
| `audit-adapters` | Audit external adapter boundaries | boundary findings or verified fixes |
| `audit-rebrand` | Audit visible brand and technical identifier boundaries | rebrand findings or verified fixes |

Examples:

```text
$paperclip-cn-fork-maintenance sync-fork
$paperclip-cn-fork-maintenance sync-fork, then prcheckloop, merge, and publish latest
$paperclip-cn-fork-maintenance audit-i18n-browser for every reachable page and dialog
$paperclip-cn-fork-maintenance review-drift for origin/master..private/master
```

## Read First

Always read `AGENTS.md`.

Read `doc/RELEASING.md` and `doc/PUBLISHING.md` when the request extends through canary or stable release, or when the diff touches release workflows, release helpers, registry verification, package publication, or desktop release assets. Read schema and contract docs only when those surfaces are touched.

If repository guidance describes a different fork or branch and conflicts with the current CN skill policy, package inventory, or invariant tests, do not silently choose a strategy. Confirm the current repository and branch, then report the conflicting sources before changing adapter or release boundaries.

Load the skill references conditionally:

- Read [sync-fork-state-machine.md](references/sync-fork-state-machine.md) for every `sync-fork`, interrupted/resumed task, PR loop, merge, canary, or latest request.
- Read [ui-localization-policy.md](references/ui-localization-policy.md) for localization architecture, content ownership, terminology, key design, wording, formatting, or rebrand decisions.
- Read [browser-i18n-audit.md](references/browser-i18n-audit.md) for browser review, a request to inspect every page/dialog/subpage, or rendered translation regressions.
- Read [maintenance-checklists.md](references/maintenance-checklists.md) for drift, Windows, Electron, adapter, rebrand, or detailed source i18n audits.

## Durable Fork Contract

Preserve these five long-lived concerns unless the user explicitly changes strategy:

1. zh-CN-first localization with bilingual switching.
2. Windows development and runtime compatibility.
3. Electron desktop packaging and desktop-specific isolation.
4. External-only adapter boundaries for Hermes, Droid, and similar third-party adapters.
5. Rebrand boundaries between visible product copy and stable technical identifiers.

The external adapter contract means:

- install external adapters through Adapter Manager or explicit external package paths
- keep core server and UI workspaces free of adapter-specific imports, built-in registrations, and dependencies
- keep host UI generic around raw package names and adapter type identifiers

The rebrand contract means:

- visible brand may use `Paperclip CN`, `penclip`, `penclip.ing`, and `paperclipai.cn`
- stable technical identifiers include `paperclip-cn`, `@penclipai/*`, `penclip`, and `PAPERCLIP_*`

Treat changes outside the five concerns as candidate drift unless they are required to absorb upstream structure or keep the sync mergeable and testable.

## Mandatory Operating Rules

### Resolve repository identity before GitHub operations

Do not infer repository ownership from the remote name `origin` or from the current directory.

1. Inspect remote URLs and map the upstream remote, fork remote, base branch, and upstream ref.
2. Resolve the fork's GitHub `OWNER/REPO` from the fork remote URL.
3. Pass that repository explicitly with `-R` or `--repo` to every `gh pr`, `gh run`, `gh workflow`, and `gh release` command.
4. Pass explicit owner and repository variables to GraphQL or REST API calls.

In the common CN checkout, `origin` can be upstream while `private` is the fork. Never let that layout route PR or release operations to upstream.

### Reconcile state before continuing

For `continue`, resumed work, or any task with existing branches, PRs, runs, or releases, run the reconciliation gate in the state-machine reference before changing state.

Use authoritative evidence to locate the first incomplete stage. Do not:

- create a second branch because the current checkout is detached
- select an unrelated open PR
- rerun already completed merge or release stages
- trust checks from an older PR head SHA
- assume a local tag or branch proves remote publication

### Preserve upstream structure

Prefer upstream page, component, service, schema, and workflow structure. Reapply fork differences as the smallest patches that protect the durable fork contract. Do not retain whole old files merely to preserve translated copy or compatibility behavior.

### Keep workflows in their owning skills

- Use `$prcheckloop` for latest-head CI polling and repair.
- Use `$release` plus the release runbooks for stable promotion.
- Keep this skill responsible for repository identity, stage transitions, fork-contract evidence, and handoff completeness.

## Completion Boundaries

`sync-fork` normally completes when:

- upstream structure has been absorbed
- the five fork concerns have been reviewed
- at least one review/fix pass has completed
- required local verification is green
- a fork-targeted PR has been created or updated

Extend beyond the PR only when the user explicitly requests `prcheckloop`, ready-for-review, merge, canary, stable, or `latest` work. In that case, continue through the requested terminal stage using the state machine and do not stop at an intermediate handoff.

If a requested stage cannot complete, report the exact repository, branch or SHA, PR or run, failed gate, attempted recovery, and required next action.

## Sync-Fork Core Workflow

Use the detailed state machine for commands and evidence. The core sequence is:

1. Reconcile local, remote, PR, and release state before changing anything.
2. Fetch the mapped upstream and fork remotes and inspect the incoming range.
3. Capture the pre-sync i18n key snapshot before merging when that stage has not already occurred.
4. Merge upstream into a sync branch, preserving upstream structure.
5. Reapply only justified fork deltas and review every merge-touched UI or locale surface.
6. Capture and compare the post-sync i18n key snapshot.
7. Run a findings-first review, fix actionable regressions, and repeat until clean.
8. Run required verification, push to the fork, and create or update the PR.
9. When explicitly requested, run latest-head PR checks, merge, verify canary, dry-run stable, publish stable, and verify external surfaces.

Default branch conventions:

- working branch: `codex/upstream-sync-YYYYMMDD`
- safety branch: `codex/upstream-sync-YYYYMMDD-safety`
- PR target: fork `master`

Continue an existing associated branch instead of creating a date-renamed duplicate.

## Localization Rules

Localize application-owned, user-visible text, including labels, system statuses, validation messages, dialogs, toasts, tooltips, placeholders, accessibility labels, and system-generated activity copy.

Keep these values raw unless a separate product policy says otherwise:

- user-authored entity names; use the controlled seeded-name policy only on intended presentation surfaces
- package names and adapter type identifiers
- provider and model identifiers
- environment variables, API fields, paths, URLs, commands, logs, stdout, stderr, and protocol payloads

English characters are review leads, not proof of a missing translation. Classify the content owner before changing it.

Follow [ui-localization-policy.md](references/ui-localization-policy.md) for command wording. Normalize by audience instead of mechanically replacing every command form.

### Catalog maintenance

`ui/locales-src/` is the editable authority for the production `common`
catalog. The checked-in files at `ui/public/locales/en/common.json` and
`ui/public/locales/zh-CN/common.json` are generated runtime artifacts: do not
hand-edit them.

Each source entry contains exactly `en`, `zh-CN`, and
`reviewedEnglishHash`. Semantic keys belong in
`semantic/domain-<first-prefix-lowercase>.json`; controlled source-text keys
belong in `source-text/<first-ascii-letter-lowercase-or-other>.json`. A key has
one source-file owner. Duplicate definitions and implicit overrides are errors.

Use this sequence for a locale edit:

```sh
pnpm i18n:build
pnpm check:i18n
```

`i18n:build` validates the editable sources and writes sorted UTF-8/LF runtime
catalogs. `check:i18n` is read-only; it rejects out-of-date generated catalogs
and English entries whose exact-string SHA-256 hash has not been explicitly
reviewed. After reviewing a changed English value, acknowledge only the intended
key:

```sh
pnpm i18n:review -- --key <exact-key>
pnpm i18n:build
pnpm check:i18n
```

The review command changes review metadata only. It does not translate text or
approve a different key. A Chinese value may remain unchanged after a confirmed
English change, but the explicit review is still required. Preserve the sole
placeholder-set exception, `scheduleDescription.dayOfMonthOrdinal`: English
uses `ordinal`, zh-CN uses `count`, and its caller supplies both. All other
paired values must expose the same placeholders.

The small upstream `translation` resources and their tests are separate from
the production common catalog. Do not merge their ownership, keys, or runtime
loading behavior into this workflow.

### Static i18n key audit

Use the skill-local script for upstream syncs, locale catalog changes, and suspected key regressions:

```sh
node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs snapshot --out .omx/i18n-key-audit/pre-sync.json
node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs snapshot --out .omx/i18n-key-audit/post-sync.json
node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs compare --before .omx/i18n-key-audit/pre-sync.json --after .omx/i18n-key-audit/post-sync.json
```

Snapshot files under `.omx/i18n-key-audit/` are local evidence and must not be committed.

The audit snapshot schema is v2. It records
`undefinedStaticTranslationCallFindings` separately from locale-key findings.
When comparing a retained v1 baseline, the comparison reports
`undefinedStaticTranslationCallBaselineUnavailable` instead of inventing legacy
zero findings. Capture a fresh v2 pre-sync snapshot before the next sync to
make new or regressed undefined static calls comparable.

Treat these compare failures as blockers until reviewed:

- removed keys
- new locale parity gaps
- duplicate keys in the same object
- likely zh-CN English fallback regressions
- new or regressed undefined static translation calls
- newly changed English entries without explicit review

Treat static `unusedKeys`, duplicate-English candidates, and dynamic
translation-call warnings as review leads, not deletion or failure oracles.
Remove a key only after exact repository search, dynamic-prefix review,
runtime-source review, and synchronized `en` and `zh-CN` edits.

### Browser i18n audit

Use `audit-i18n-browser` when the user requests rendered review. Full audits derive reachable routes from `ui/src/App.tsx`; impact audits cover routes and shared surfaces touched by the diff. Record coverage and findings using the browser reference rather than relying on memory.

Trace missing text to its component and locale key. Do not fix browser findings with hardcoded Chinese.

## Verification

For `sync-fork` and broad fixes, default to:

```sh
pnpm test:upstream-merge-harness
pnpm -r typecheck
pnpm test:run
pnpm build
```

Run focused checks first when they speed diagnosis, then retain the full gate unless the work is docs-only, explicitly narrowed, or a gate is demonstrably unrelated and the reason is reported.

Common targeted checks:

- `pnpm test:windows-compat`
- `pnpm --filter @penclipai/desktop-electron run pack`
- `pnpm check:token-gates` for UI changes
- targeted Vitest suites for touched helpers, routes, or components
- locale catalog tests plus the i18n key snapshot tool

## PR And Release Rules

Evaluate merge readiness against the latest PR head SHA. Every required check must be terminal green, mergeability must be known, and draft status must be cleared before merge.

For explicit latest requests:

- prove the automatic canary corresponds to the merged fork `master` SHA
- resolve stable version with the release helper and an explicit `stable_date`
- never derive stable version from a canary tag or wall-clock date
- run stable dry-run before live promotion using the same source ref and stable date
- verify every `publishFromCi` package through the release manifest and registry verifier
- verify remote stable tag, GitHub Release, release jobs, smoke, and documented desktop asset contract

Keep exact release commands in `doc/RELEASING.md`; do not duplicate them here.

## Output

Report only evidence relevant to the requested terminal stage:

- mapped upstream and fork repositories and refs
- current branch or detached HEAD and authoritative SHA
- resumed stage and stages skipped as already complete
- touched fork concerns and intentionally preserved deltas
- i18n snapshots or browser coverage when applicable
- verification commands and results
- PR latest head/check summary when applicable
- canary, stable, registry, tag, release, smoke, and desktop evidence when applicable
- remaining risks or a precise blocker

Do not embed one-off PR numbers, run IDs, versions, transient warnings, or local recovery incidents into this skill.
