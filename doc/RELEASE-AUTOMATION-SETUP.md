# Release Automation Setup

This document covers the GitHub and npm setup required for the current Paperclip release model:

- automatic canaries from `master`
- manual stable promotion from a chosen source ref
- npm trusted publishing via GitHub OIDC for every CI publish lane
- protected release infrastructure in a public repository

| Publish jobs | Credential source |
| --- | --- |
| Preview, canary, nightly, beta, and stable | npm trusted publisher for `penclipai/paperclip-cn`, workflow `release.yml`, through GitHub OIDC |

Repo-side files that depend on this setup:

- `.github/workflows/release.yml`
- `.github/CODEOWNERS`

Note:

- the release workflows intentionally use `pnpm install --no-frozen-lockfile`
- this matches the repo's current policy where `pnpm-lock.yaml` is refreshed by GitHub automation after manifest changes land on `master`
- the publish jobs then restore `pnpm-lock.yaml` before running `scripts/release.sh`, so the release script still sees a clean worktree
- package installation and lifecycle scripts remain on the pinned `pnpm` 9 path; GitHub-hosted publish jobs install pinned npm `11.18.0` only for npm's delegated OIDC trusted-publishing support
- the release wrapper scopes that delegated npm through the `npm_config_npm_path` setting for each `pnpm` publish command (for example, `npm_config_npm_path="$OIDC_NPM_PATH" pnpm "$@"`); do not append `--npm-path` to a pnpm CLI command, because pnpm 9 forwards that argument and the publish arguments to npm
- do not manually rewrite package manifests to switch npm clients; the existing release packaging lifecycle continues to own those temporary rewrites

## PR quality review authentication

The PR review workflow reads and executes only the event's fixed base commit.
It does not execute PR-head code. Dependency Review and the quality gates stay
enabled with `contents: read` and `pull-requests: write` permissions.

The workflow selects credentials from a fixed repository name and ID pair:

- `penclipai/paperclip-cn:1192887762` uses the job's temporary `github.token`.
  Its quality-gate comments belong to `github-actions[bot]`. The CN fork does
  not need the upstream App's `COMMITPERCLIP_KEY`.
- `paperclipai/paperclip:1170821064` uses the commitperclip App and its existing
  private-key secret.
- Other repository identities fail before running the review.

Comment updates require the selected bot author and the quality-gate signature.
CN comments also carry the fixed `<!-- commitperclip-quality-gates:v1 -->`
marker, so another workflow's GitHub Actions comment is not updated by mistake.
Repeated runs update the matching quality-gate comment instead of adding copies.
These review credentials are separate from the npm publication credentials below.

## 1. Merge the Repo Changes First

Before touching GitHub or npm settings, merge the release automation code so the referenced workflow filenames already exist on the default branch.

Required files:

- `.github/workflows/release.yml`
- `.github/CODEOWNERS`

## 2. Configure npm Trusted Publishing

Configure this for every public package used by a CI publish job. All lanes in
`release.yml` must be covered by one or more npm trusted-publisher
relationships that match their actual job identity and environment.

At minimum that includes:

- `penclip`
- `@penclipai/server`
- `@penclipai/ui`
- public packages under `packages/`

### 2.1. In npm, open each package settings page

For each package:

1. open npm as an owner of the package
2. go to the package settings / publishing access area
3. add a trusted publisher for the GitHub repository `penclipai/paperclip-cn`

### 2.2. Audit the trusted-publisher relationship for each package

npm supports up to 10 trusted publisher relationships per package. Existing
relationships are immutable, so first inspect the existing npm-side entries for
every release-enabled package. Do not assume that there is only one entry, or
delete, revoke, or recreate an entry solely to make this checklist look uniform.

For a relationship intended to authorize this release workflow, verify the full
tuple against the actual publishing job:

- organization or user: `penclipai`
- repository: `paperclip-cn`
- workflow filename: `release.yml` (npm expects the filename, not the path)
- environment: inspect the actual configured environment value and verify that
  it covers the required release job; the field is optional, but an empty value
  must not be assumed to authorize every GitHub environment
- allowed actions: explicitly allow direct `npm publish`, because
  `scripts/release.sh` publishes directly. A newly created relationship defaults
  to staged publishing only and can otherwise stop a multi-package release
  after its first accepted package.

If a job needs npm dist-tag management, review that separate allowed action as
well; npm treats it independently from direct publish permission.

The single `release.yml` workflow handles every CI publish lane through OIDC.
GitHub environments still enforce their existing approval and branch policies;
the npm relationship must be checked against each job's actual environment
rather than relying on a generic empty-environment assumption.

### 2.2.1. Newly added public packages need a bootstrap phase

Trusted publishing is configured on the npm package itself, not at the repo scope.
That means a brand-new public package must not be auto-enrolled into CI publishing until its npm package exists and its trusted publisher has been configured.

Repo policy:

1. add every non-private package to [`scripts/release-package-manifest.json`](../scripts/release-package-manifest.json)
2. set `"publishFromCi": true` only when CI is expected to publish that package
3. if the package is not ready for CI publishing yet, keep `"publishFromCi": false`
4. complete the package bootstrap before merging any PR that changes a release-enabled new package

Bootstrap sequence for a new package:

1. publish the package once from a trusted maintainer machine using normal npm auth
2. open that package on npm and add the `penclipai/paperclip-cn` trusted publisher for `.github/workflows/release.yml`
3. explicitly allow direct `npm publish` and inspect the environment value against the target release job
4. confirm the package's `repository.url` exactly identifies `https://github.com/penclipai/paperclip-cn`
5. complete the first successful OIDC publish within two days of creating the relationship; otherwise npm expires the unvalidated relationship
6. only then enable `"publishFromCi": true`

The repository release guard validates the manifest, package identity, and
internal package graph before publication. It cannot inspect private npm-side
trusted-publisher relationships. Auditing npm-side relationships for every
`"publishFromCi": true` package is a separate release prerequisite. The current
manifest contains 32 such packages; always derive the audit set from the current
manifest instead of relying on this count.

### 2.3. Verify the CI OIDC publisher

After the workflows are live:

1. audit the npm-side relationship tuple and direct-publish permission for every release-enabled package
2. confirm every package's `repository.url` exactly identifies the CN fork
3. confirm a GitHub-hosted canary publish succeeds through OIDC without receiving `NPM_TOKEN`
4. verify each other enabled publish lane through OIDC while retaining the existing environment approval and branch policies

A repository dry-run or package-map check validates repository-local data; it
does not prove the npm-side relationship exists, has the needed action, or is
valid for the job environment. A successful direct OIDC publish is the first
validation of a newly created relationship.

This migration does not remove existing `NPM_TOKEN` environment settings. Keep
them untouched until all release-enabled packages have completed successful OIDC
publishes; remove or rotate them only in a separately approved cleanup change.

## 3. Preserve Existing npm Token Settings During the OIDC Migration

CI publishing no longer receives `NPM_TOKEN`; it uses npm trusted publishing
with an OIDC identity instead. Existing local npm login or token-based access
still supports the one-time bootstrap publish of a new package.

1. leave existing `NPM_TOKEN` environment settings unchanged while validating the OIDC rollout
2. do not disable npm token publishing on package settings as part of this rollout
3. schedule any secret removal, rotation, or npm token-policy change as a separate explicit cleanup after OIDC has succeeded for every release-enabled package

Goal:

- no CI publish job needs a persistent npm token
- local maintainer bootstrap remains possible through normal interactive npm authentication

## 4. Create GitHub Environments

Create three environments in the GitHub repository:

- `npm-canary`
- `npm-beta`
- `npm-stable`

Path:

1. GitHub repository
2. `Settings`
3. `Environments`
4. `New environment`

## 5. Configure `npm-canary`

Recommended settings for `npm-canary`:

- environment name: `npm-canary`
- required reviewers: none
- wait timer: none
- deployment branches and tags:
  - selected branches only
  - allow `master`

Reasoning:

- every push to `master` should be able to publish a canary automatically
- no human approval should be required for canaries

The scheduled nightly lane also publishes under `npm-canary`: it is the same
trust level (fully automated, no human gate), its runs execute on `master` so
the branch rule is satisfied, and publishing still happens from `release.yml`
(see section 2.2). Canary and nightly use OIDC and do not receive `NPM_TOKEN`.
If this environment already contains an `NPM_TOKEN`, leave it in place during
the rollout; it is not a release-job input after OIDC is enabled.

## 5.1. Configure `npm-beta`

Recommended settings for `npm-beta`:

- environment name: `npm-beta`
- required reviewers: at least one maintainer
- prevent self-review: enabled when your team size allows it
- wait timer: none
- deployment branches and tags:
  - selected branches only
  - allow `master`

Reasoning:

- beta promotions are deliberate human decisions; the required reviewer on
  this environment is the promotion gate
- create this environment before the first `channel: beta` dispatch. If the
  workflow runs first, GitHub auto-creates the environment with no
  protection rules, and that first beta would publish without approval

Like nightly, beta publishing lives in `release.yml`, so no npm
trusted-publisher changes are needed (see section 2.2).
The beta job uses OIDC and does not receive `NPM_TOKEN`.

## 6. Configure `npm-stable`

Recommended settings for `npm-stable`:

- environment name: `npm-stable`
- required reviewers: at least one maintainer other than the person triggering the workflow when possible
- prevent self-review: enabled
- admin bypass: disabled if your team can tolerate it
- wait timer: optional
- deployment branches and tags:
  - selected branches only
  - allow `master`

Reasoning:

- stable publishes should require an explicit human approval gate
- the workflow is manual, but the environment should still be the real control point

Stable publishing also uses OIDC and does not receive `NPM_TOKEN`. Preserve an
existing environment secret during the migration, but do not treat it as a
workflow input or remove it until the separate cleanup described in section 3.

## 7. Protect `master`

Open the branch protection settings for `master`.

Recommended rules:

1. require pull requests before merging
2. require status checks to pass before merging
3. require review from code owners
4. dismiss stale approvals when new commits are pushed
5. restrict who can push directly to `master`

At minimum, make sure workflow and release script changes cannot land without review.

## 8. Enforce CODEOWNERS Review

This repo now includes `.github/CODEOWNERS`, but GitHub only enforces it if branch protection requires code owner reviews.

In branch protection for `master`, enable:

- `Require review from Code Owners`

Then verify the owner entries are correct for your actual maintainer set.

Current file:

- `.github/CODEOWNERS`

If `@cryppadotta` is not the right reviewer identity in the public repo, change it before enabling enforcement.

## 9. Protect Release Infrastructure Specifically

These files should always trigger code owner review:

- `.github/workflows/release.yml`
- `scripts/release.sh`
- `scripts/release-lib.sh`
- `scripts/release-package-map.mjs`
- `scripts/create-github-release.sh`
- `scripts/rollback-latest.sh`
- `doc/RELEASING.md`
- `doc/PUBLISHING.md`

If you want stronger controls, add a repository ruleset that explicitly blocks direct pushes to:

- `.github/workflows/**`
- `scripts/release*`

## 10. Do Not Store a Claude Token in GitHub Actions

Do not add a personal Claude or Anthropic token for automatic changelog generation.

Recommended policy:

- stable changelog generation happens locally from a trusted maintainer machine
- canaries never generate changelogs

This keeps LLM spending intentional and avoids a high-value token sitting in Actions.

## 11. Verify the Canary Workflow

After setup:

1. merge a harmless commit to `master`
2. open the `Release` workflow run triggered by that push
3. confirm it passes verification
4. confirm publish succeeds under the `npm-canary` environment
5. confirm npm now shows a new `canary` release
6. confirm a git tag named `canary/vYYYY.MDD.P-canary.N` was pushed

Install-path check:

```bash
npm install --prefix "$(mktemp -d)" paperclipai@canary --no-audit --no-fund
```

The release script runs this clean-prefix install after publishing every workspace
package dependency-first and publishing `paperclipai` last. A package that is not
yet registry-visible stops the train before the channel entrypoint can advance.

## 12. Verify the Stable Workflow

After at least one good canary exists:

1. resolve the target stable version with `./scripts/release.sh stable --date YYYY-MM-DD --print-version`
2. prepare `releases/vYYYY.MDD.P.md` on the source commit you want to promote
3. open `Actions` -> `Release`
4. run it with:
   - `source_ref`: the tested commit SHA or canary tag source commit
   - `stable_date`: leave blank or set the intended UTC date like `2026-03-18`
     do not enter a version like `2026.318.0`; the workflow computes that from the date
   - `dry_run`: `true`
5. confirm the dry-run succeeds
6. rerun with `dry_run: false`
7. approve the `npm-stable` environment when prompted
8. confirm npm `latest` points to the new stable version
9. confirm git tag `vYYYY.MDD.P` exists
10. confirm the GitHub Release was created

Implementation note:

- the GitHub Actions stable workflow calls `create-github-release.sh` with `PUBLISH_REMOTE=origin`
- local maintainer usage can still pass `PUBLISH_REMOTE=public-gh` explicitly when needed

## 13. Suggested Maintainer Policy

Use this policy going forward:

- canaries are automatic and cheap
- stables are manual and approved
- only stables get public notes and announcements
- release notes are committed before stable publish
- rollback uses `npm dist-tag`, not unpublish

## 14. Troubleshooting

### Trusted publishing fails with an auth error

These checks apply to every OIDC publish job, including canary and stable.

Check:

1. the workflow filename on GitHub exactly matches the filename configured in npm
2. the package has the trusted publisher entry for the correct repository
3. the job has `id-token: write`
4. the job runs on a GitHub-hosted runner
5. the job's repository is `penclipai/paperclip-cn`
6. every release-enabled package has a repository URL that exactly identifies the CN fork
7. the npm-side relationship for that package explicitly allows direct `npm publish`
8. the relationship's environment value covers the publishing job

### Stable workflow runs but never asks for approval

Check:

1. the `publish_stable` job uses environment `npm-stable`
2. the environment actually has required reviewers configured
3. the workflow is running in the canonical repository, not a fork

### CODEOWNERS does not trigger

Check:

1. `.github/CODEOWNERS` is on the default branch
2. branch protection on `master` requires code owner review
3. the owner identities in the file are valid reviewers with repository access

## Related Docs

- [doc/RELEASING.md](RELEASING.md)
- [doc/PUBLISHING.md](PUBLISHING.md)
- [doc/plans/2026-03-17-release-automation-and-versioning.md](plans/2026-03-17-release-automation-and-versioning.md)

## Runner verification dependency cache

`release-verify.yml` runs `Verify Paperclip Runner` on two independent runners.
The protocol lane runs `check:eval-kernel` and `check:protocol`. The Rust lane
runs `check:runner` and `check:api-authority`. Together they retain every check
in `check:all`; both lanes must pass before Cloud source verification or
readiness can succeed. A failed lane does not cancel the other lane.

Both lanes restore Cargo dependencies with the pinned Rust Cache action. The
compiler comes from the Runner package's `rust-toolchain.toml` before the action
computes its key. Compiler and Cargo metadata changes select a new cache. The
`release-runner-v2` shared key avoids separate copies for these lanes.
Only the Rust lane saves this cache. After verification it also runs `build:rust`
to warm the debug dependencies used by the protocol lane; its own tests already
warm release dependencies. The cache writer is shorter than the protocol lane.

GitHub matches a cache entry on its key and on a version hash of the absolute
paths in the entry. The master writer runs on the RunsOn fleet, where the
checkout is `/home/runner/_work/paperclip/paperclip`. The trusted PR workflow
restores the same entry read-only on GitHub-hosted runners, where the checkout
is `/home/runner/work/paperclip/paperclip`. A `Pin the Runner Rust workspace
path` step in both workflows links `$HOME/paperclip-runner-rust` to the Runner
crate and passes that path to the cache action, so both layouts hash the same
paths and the PR lanes can restore master's entry. The guard tests under
`.github/scripts/tests/` require this step, with identical text, before every
Rust cache step in both workflows.

Workspace crates and installed Cargo binaries are excluded from this entry.
Every run runs all assigned checks, including on a cache hit. Only an
own-repository master-push run verifying that push's exact SHA can restore the
cache, and only a successful Rust lane saves it. PR, tag, and manual candidate
verification compile without this cache. A miss or eviction costs compilation
time but does not change the checks. To discard old dependency caches, increment
the shared-key version and let the next successful master verification warm it.

### Runner release crate cache

The dependency entry leaves the Runner's own crate out, and a fresh checkout
invalidates cargo's mtime fingerprints for workspace crates anyway, so every
pull request build compiled `paperclip-runner-core` in release mode from
scratch (28-49s per job on 2026-10-11) although most master commits leave its
inputs untouched. A second, content-addressed entry holds only that crate's
release artifacts: its fingerprints, the lib's rlib and rmeta, the
`paperclip-runnerd` binary and their dep-info, about 70 MB. The path list and
the key inputs live in `scripts/runner-release-crate-cache.mjs`, which both
workflows call, and `scripts/__tests__/runner-release-crate-cache.test.mjs`
holds the readers and the writer to them.

The key is `runner-release-crate-v1-<scope>-<hashFiles>`. The scope names the
platform, the pinned compiler (`rustc --version --verbose`: release, commit and
host) and a hash of the checkout root, because cargo's dep-info records the
protocol files the crate includes by relative path as absolute paths. The
`hashFiles` part covers every input the build reads: the toolchain pin, the
manifests and lockfile, the crate sources, the protocol schemas and fixtures,
and the three fixture trees the test modules include (two under the Runner
package and `tests/runner-e2e/fixtures` at the repository root). Any change
to any of them selects a new key. A guard test resolves every `include_str!`
and `include_bytes!` in the crate, whether its argument is a literal or a
`concat!` of literals, `env!("CARGO_MANIFEST_DIR")` and macro metavariables,
and fails on an include that lands outside these patterns or uses a form it
cannot resolve. Readers pass no `restore-keys`: a prefix match would hand
cargo another revision's output.

The writer is the Rust lane of the same master-push verification, after its
checks and the debug warm-up. It looks the key up first and, on a miss, runs
`cargo clean --release -p paperclip-runner-core` and then the package's
`build:binary` (the exact command the readers run) before saving, so the entry
carries no test-profile variants. In the trusted PR workflow, the Typecheck,
Build and Canary Dry Run jobs and the two Verify Paperclip Runner lanes that
build the crate (`rust` and the final vitest shard) restore the entry
read-only right after the dependency restore. On a hit, `mark-current` sets
the mtime of every restored artifact to now, so cargo's freshness check sees
every source as older than the build and keeps the artifacts. A restore that
lacks any file cargo reads or checks for either unit (the fingerprint hash
and dep-info of each unit, the lib's rlib and rmeta, the binary under
`deps`; measured with cargo 1.97.1, which recompiles without any one of
them and recreates the uplifted binary without any of the rest) is removed
instead, the job log names the missing file, and cargo compiles as on a
miss. `pnpm build`
then prints `Finished release profile` in well under a second for that crate.
On a miss nothing changes: cargo compiles the crate as before.

The trust boundary is unchanged: only master writes, a pull request can only
restore master's entry, and it restores only artifacts built from inputs
byte-identical to its own merge tree.

The trust boundary is the protected master branch, not the cache-key text.
GitHub does not let master restore caches created by a child branch, sibling
branch, tag, or PR merge ref. Both permitted restore scopes (current branch and
default branch) are master here. A workflow with authority to execute arbitrary
code on master can affect verification directly and is already trusted. The
cache contains dependency build artifacts, not credentials or workspace output.
See [GitHub cache access restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching#restrictions-for-accessing-a-cache).

## Chat integration test shards

Release verification runs the large chat integration file on three independent
runners. Five other server shards cover every remaining general server file.
The ordinary local test command and trusted PR workflow keep their complete
`general-server` group. Each chat case shuts down its services, pauses its own
still-active endpoints, and retires its active/waiting conversations after
assertions. This keeps workers in later cases from claiming earlier
fixtures in the shared test database. Application assertions stay unchanged.

Each chat job collects active tests with Vitest, groups cases by source line,
and balances those groups by case count. Parameterized cases and loop-generated
cases on one line stay together. The job re-collects with the exact line filters
it will execute and fails if the selected case identities differ. Hooks and test
execution remain sequential inside each runner with its own temporary home.

Run one shard locally with:

```sh
pnpm test:run:general -- --group general-chat --shard-index 0 --shard-count 3
```

Use indexes 0, 1, and 2 to run the complete chat suite. The CLI validates that
each shard has work and that collection includes usable source locations. A
Vitest collection or filtering change fails verification instead of dropping
tests. Splitting adds three release-verification jobs and repeats collection and
fixture setup; it does not make a single test faster.

The file-duration manifest also records the native Codex Runner integration
suite's measured import and execution cost, so the existing file balancer
accounts for it in both ordinary PR and release verification.


## Cloud readiness runner placement

When AWS routing is enabled, Cloud image builds use `paperclip-cloud-build-x64`
and source verification uses `paperclip-post-merge-x64`. The artifact wait and
the `Cloud source verified v1` and `Cloud deployable v1` marker jobs run on
GitHub-hosted runners. These small jobs must not hold or wait for capacity in
the source-verification fleet. During a merge
burst, even a completed build must wait for its marker before consumers can
recognize readiness.

Runner placement does not change readiness requirements: exact-source artifacts,
all source checks, and the image verification must still pass. The versioned
markers and their dependency gates are unchanged.
