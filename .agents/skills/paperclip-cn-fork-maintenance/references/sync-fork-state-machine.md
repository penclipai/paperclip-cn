# Sync-Fork State Machine

Use this reference for every upstream sync, interrupted task, PR continuation, merge, canary check, or latest release request.

## Contents

1. Repository identity
2. Branch and merge policy
3. Reconciliation gate
4. Stage model
5. Sync and review stages
6. Lockfile and test discipline
7. PR and merge rules
8. Canary and stable rules
9. Publication verification
10. Blockers and output

## Repository Identity

Resolve concepts before using remote names:

| Concept | Meaning |
|---|---|
| upstream remote | original Paperclip repository |
| fork remote | Paperclip CN repository |
| base branch | fork branch receiving the PR, normally `master` |
| upstream ref | upstream default branch, normally `<upstream remote>/master` |
| fork repository | GitHub `OWNER/REPO` parsed from the fork remote URL |

Start with read-only inspection:

```sh
git status --short --branch
git branch --show-current
git rev-parse HEAD
git remote -v
git branch -vv
```

Fetch each mapped remote with pruning before comparing refs. A detached HEAD is a state to classify, not a reason to create a branch.

Resolve the GitHub repository from the fork remote URL. Use it explicitly:

```sh
gh pr view <PR> -R <fork-owner/repo> --json number,state,headRefName,headRefOid,baseRefName,isDraft,mergeable,mergedAt,mergeCommit,url,statusCheckRollup
gh run list -R <fork-owner/repo> --commit <SHA> --json databaseId,workflowName,status,conclusion,headSha,url
gh release view <TAG> -R <fork-owner/repo> --json tagName,isDraft,isPrerelease,publishedAt,url,assets
```

For REST and GraphQL calls, provide the resolved owner and repository explicitly. Do not use `{owner}/{repo}` placeholders whose resolution depends on the checkout.

## Branch And Merge Policy

Upstream syncs use a work branch and PR; do not merge or push directly from local `master`.

Default names:

- work branch: `codex/upstream-sync-YYYYMMDD`
- safety branch: `codex/upstream-sync-YYYYMMDD-safety`
- fork base branch: `master`

Continue an existing associated branch instead of creating a date-renamed duplicate. For a genuinely new sync, create the work branch from the explicit fork base ref, then create the safety branch before merging upstream.

Default to merge, not rebase:

```sh
git merge <upstream remote>/master
```

Before the upstream merge, compare the work branch with `<fork remote>/master`. If the fork base contains commits missing from the work branch, merge the fork base first.

Keep the sync PR scoped to:

- the upstream merge
- restoration or completion of the five durable fork concerns
- narrow fixes required to make the synchronized branch usable, testable, and mergeable

Do not add unrelated refactors, visual redesigns, new product features, or heavyweight environment tests merely because the sync branch is already large.

## Reconciliation Gate

Run this gate before the first mutation and again after any interruption.

### Local and remote state

Record:

- dirty, staged, and untracked files
- current branch or detached HEAD
- local HEAD SHA
- upstream and fork remote URLs
- upstream default-branch SHA
- fork base-branch SHA
- local branches containing HEAD
- ahead/behind relation between the work branch and fork base

Never discard unrelated local changes. If they affect the task, work with them; if they make safe continuation impossible, report the conflict precisely.

### PR state

Prefer association in this order:

1. an explicit PR number from the request
2. a PR whose head branch exactly matches the current work branch
3. a known PR whose head or merge commit matches the recorded task SHA
4. commit ancestry between the task branch and a merged PR

Do not select a PR merely because it is open or recent. Confirm its fork repository, base branch, head branch, and head SHA.

Record:

- PR state and URL
- head branch and latest head SHA
- base branch
- draft status and mergeability
- merged timestamp and merge commit when merged
- latest-head check rollup

If the PR head changes after a push, discard the previous check conclusion and restart `$prcheckloop` on the new SHA.

### Release state

Inspect release state only when the requested terminal stage reaches canary or stable. Record:

- fork `master` SHA after merge
- release workflow runs for that SHA
- canary tag and npm canary dist-tag
- stable dry-run and live runs for the chosen source ref and stable date
- stable tag, GitHub Release, registry state, smoke, and desktop assets

Do not treat a local tag, workflow summary, or npm CLI package alone as proof of a complete stable release.

## Stage Model

Locate the first stage whose completion evidence is missing or invalid. Skip earlier stages and report why they were already complete.

| Stage | Completion evidence | Continue with |
|---|---|---|
| 0. Context | remotes, fork repository, worktree, HEAD, refs, and requested terminal stage recorded | inspect sync state |
| 1. Pre-sync audit | incoming upstream range reviewed and pre-sync i18n snapshot captured when still possible | merge upstream |
| 2. Merge and fork repair | upstream merged; conflicts resolved; durable fork deltas reapplied | post-sync audit |
| 3. Audit and review | post-sync snapshot compared; browser/maintenance findings reviewed; at least one fix pass complete | verification |
| 4. Local verification | required targeted and broad gates green on current HEAD | PR delivery |
| 5. PR delivery | branch pushed to fork; PR created or updated with required template and evidence | stop or run PR loop |
| 6. PR readiness | latest-head checks terminal green; mergeability known; draft cleared | merge |
| 7. Merge and canary | PR merged to fork base; canary workflow/tag/registry point to merge SHA | stop or stable dry-run |
| 8. Stable dry-run | dry-run succeeds for explicit source ref and stable date | live stable |
| 9. Stable live | live workflow succeeds for the same source ref and stable date | external verification |
| 10. Published latest | all release-enabled packages, tag, GitHub Release, smoke, and desktop contract verified | complete |

If a pre-sync snapshot is unavailable because the merge already occurred, do not fabricate it or restart the merge. Mark the baseline unavailable, inspect the merge range and touched locale/UI files, capture the current snapshot, and continue with explicit reduced evidence.

## Sync And Review Stages

Before merging:

1. Align the work branch with the fork base branch.
2. Inspect commits and changed paths in the incoming upstream range.
3. Run `pnpm check:i18n` and capture a fresh v2
   `.omx/i18n-key-audit/pre-sync.json`. A retained v1 snapshot cannot baseline
   undefined static translation calls; comparison reports that gap explicitly.
4. Classify touched paths against the five fork concerns.

After merging:

1. Preserve upstream structure during conflict resolution.
2. Reapply fork changes as narrow patches.
3. Recheck every merge-touched UI, locale, Windows, Electron, adapter, and rebrand surface.
4. Update `ui/locales-src/` for affected production catalog entries, explicitly
   review changed English values, then run `pnpm i18n:build` and
   `pnpm check:i18n`. Do not resolve conflicts by editing generated
   `common.json` files.
5. Capture and compare `.omx/i18n-key-audit/post-sync.json`; record real
   missing static calls, unreviewed English, and dynamic-prefix leads.
6. Run findings-first review and fix actionable regressions. Static unused keys
   and duplicate-English candidates are not deletion authority.
7. Repeat review and verification when a fix changes the evidence.

Use this conflict priority:

- normally accept upstream structure for pages, shared components, routes, services, manifests, build scripts, and adapter implementations
- manually reconcile locale catalogs, i18n entrypoints, locale middleware, user-visible error handling, and fork-maintenance skill resources
- preserve CN-specific README or operator guidance only as narrow content changes, not whole-file replacements

Never resolve broad conflicts with blanket `ours` or `theirs`. Keep upstream-added locale keys, then reapply zh-CN translations and fork-specific presentation behavior.

## Lockfile And Test Discipline

### Lockfile ownership

Do not include `pnpm-lock.yaml` when package-manager inputs did not change. Package-manager inputs include workspace/package manifests, `pnpm-workspace.yaml`, `.npmrc`, and `pnpmfile.*`.

When the lockfile changes:

1. Compare against the worktree baseline captured before the sync.
2. Confirm the change belongs to the current task.
3. Preserve any user change that predates the task.
4. Commit only the minimal lockfile change required by the synchronized manifests.

Do not use an unconditional worktree restore as cleanup. If ownership is uncertain, keep the change visible and report it.

### Clean dependency verification

When dependency, workspace wiring, or locale infrastructure changes, include a frozen-lockfile install and focused locale tests before the broad gate:

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run server/src/__tests__/ui-locale.test.ts server/src/__tests__/i18n.test.ts
```

### Upstream merge harness

Run `pnpm test:upstream-merge-harness` after conflict repair and before the broad gate.

The harness contains only invariants that are repeatedly vulnerable during manual upstream merges. Keep it:

- infrastructure or contract focused
- lightweight and deterministic
- free of external services and heavyweight environment setup

The concrete test list belongs in `scripts/upstream-merge-harness.mjs`, not this policy. Add a regression to the harness only when it represents a recurring merge-sensitive invariant; otherwise keep it in the normal focused test suite.

### Test weight

If the full suite becomes slow or flaky after sync, identify the expensive suite and its ownership before changing global worker or timeout defaults. Prefer extracting helpers, lowering the test layer, and removing duplicated probe time from newly added coverage. Do not delete upstream coverage for speed or retain global timeout workarounds after the root cause is fixed.

## PR And Merge Rules

Create or update the PR in the resolved fork repository and target the fork base branch. Fill every section of `.github/PULL_REQUEST_TEMPLATE.md`.

Push the explicit work branch to the fork remote. If sync work was accidentally completed on local `master`, first create and push a work branch that preserves the result; do not force-move local `master` until ownership and remote safety have been verified separately.

For ordinary `sync-fork`, a draft PR is acceptable as the terminal artifact. For an explicit merge or latest request:

1. Push all fixes.
2. Refresh the PR's latest head SHA.
3. Run `$prcheckloop` for the explicit PR while applying the repository-safe overlay below.
4. Mark ready when local verification and required PR content are complete.
5. Confirm all required contexts are terminal green, mergeability is known, and the head SHA has not changed.
6. Merge through the fork repository.
7. Record the resulting fork base-branch merge SHA.

Never merge from an older green SHA or infer readiness from a single aggregate check.

### Repository-safe PR check overlay

The CN fork's resolved repository identity overrides repository-implicit examples in the generic `$prcheckloop` skill:

- carry the explicit PR number, fork `OWNER/REPO`, and fork push remote into the loop
- add `-R <fork-owner/repo>` to every `gh pr` and `gh run` command
- replace `gh api` repository placeholders with `repos/<fork-owner/repo>/...`
- pass the resolved owner and repository name explicitly to GraphQL
- push the explicit work branch to the verified fork remote instead of relying on tracking configuration

Do not execute a repository-implicit example verbatim in a checkout with multiple remotes.

## Canary And Stable Rules

### Canary

After merge, verify that the automatic canary belongs to the fork base-branch merge SHA:

- release workflow `headSha` matches
- canary tag resolves to that SHA
- npm `canary` reports the expected published candidate
- required canary smoke is successful

Do not promote a canary associated with an older base-branch commit.

### Stable version resolution

Choose and record an explicit `source_ref` and UTC `stable_date`. Resolve the version with the repository release helper and explicit fork release remote, following `doc/RELEASING.md`.

Do not:

- derive stable version from the canary version
- substitute a version string for `stable_date`
- silently switch source refs between dry-run and live
- use the workstation's current date without recording it as the chosen stable date

### Dry-run and live

Run stable dry-run first. Continue to live only when the dry-run is successful for the intended source ref and stable date. Before dispatching live, recheck that no intervening publication changed the resolved version or candidate assumptions.

Dispatch live with the same source ref and stable date, then wait for the full workflow graph to finish. A successful publish job is not enough if downstream smoke or desktop jobs fail.

## Publication Verification

Use `scripts/release-package-manifest.json` as the package source of truth. Select every entry with `publishFromCi: true`, then invoke `scripts/verify-release-registry-state.mjs` with:

- `--channel stable`
- `--dist-tag latest`
- the resolved `--target-version`
- one `--package` argument for every selected package

Parse the manifest with a structured JSON parser. Do not maintain a duplicated package list in the skill.

Verify all external surfaces:

1. Registry verifier succeeds for every release-enabled package and its internal dependency graph.
2. Remote stable tag resolves to the promoted source commit.
3. GitHub Release is neither draft nor prerelease and references the stable tag.
4. Live release workflow and required jobs are terminal successful for the promoted SHA.
5. Stable smoke succeeds against `latest`.
6. Desktop assets satisfy the platform and naming contract in `doc/RELEASING.md`.

Warnings and annotations may be reported separately, but completion is determined by required contracts and terminal job conclusions rather than incidental log text.

## Blockers And Output

Stop only at the requested terminal stage or a precise unrecoverable blocker. Report:

- requested terminal stage and first incomplete stage
- fork repository and authoritative SHA
- associated PR or workflow URL
- exact failing or missing gate
- recovery already attempted
- credentials, permission, external service, or repository change required next

Do not turn a transient incident into a durable skill rule unless it represents a recurring contract or ownership boundary.
