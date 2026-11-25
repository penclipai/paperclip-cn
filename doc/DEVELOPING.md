# Developing

How to set up, run, and test Paperclip locally. The project runs fully in local
dev without setting up PostgreSQL manually.

This file holds setup, commands, and everyday workflow only. Notes on how a
subsystem behaves belong in that subsystem's doc; see
[More documentation](#more-documentation).

## Prerequisites

- Node.js 24.11+
- pnpm 9+

## Start Dev

From repo root:

```sh
pnpm install
pnpm dev
```

This starts:

- API server: `http://localhost:3100`
- UI: served by the API server in dev middleware mode (same origin as API)

`pnpm dev` runs the server in watch mode and restarts on changes from workspace packages (including adapter packages). Use `pnpm dev:once` to run without file watching.

`pnpm dev:once` auto-applies pending local migrations by default before starting the dev server.

`pnpm dev` and `pnpm dev:once` are idempotent for the current repo and instance: if the matching Paperclip dev runner is already alive, Paperclip reports the existing process instead of starting a duplicate.

To run against a separate local state root, pass `--data-dir`. The dev runner
translates it to an isolated `PAPERCLIP_HOME` before migration checks or server
startup, so embedded PostgreSQL and other default instance state live under that
directory:

```sh
pnpm dev --data-dir ./tmp/paperclip-dev
```

Pass the same option to the service-management commands so they use the
isolated runtime-service registry:

```sh
pnpm dev:list --data-dir ./tmp/paperclip-dev
pnpm dev:stop --data-dir ./tmp/paperclip-dev
```

Issue execution may also use project execution workspace policies and workspace runtime services for per-project worktrees, preview servers, and managed dev commands. Configure those through the project workspace/runtime surfaces rather than starting long-running unmanaged processes when a task needs a reusable service.

Inspect or stop the current repo's managed dev runner:

```sh
pnpm dev:list
pnpm dev:stop
```

`pnpm dev:once` tracks backend-relevant file changes and pending migrations. When the current boot is stale, the board UI shows a `Restart required` banner. You can also enable guarded auto-restart in `Instance Settings > Experimental`, which waits for queued/running local agent runs to finish before restarting the dev server.

### Mobile-friendly preview (`pnpm dev:mobile`)

The vite dev server serves an unbundled module graph. This is fast to reload on a local machine but too heavy for phones and tablets on slow links (airplane wifi, mobile data, distant tailnet peers). `pnpm dev:mobile` builds the UI once and serves the small production bundle on port `3101` via `vite preview`, proxying `/api` requests to the dev API on `3100`.

- `pnpm dev:mobile` — build the UI and start the preview server on `:3101`. Rebuild manually to pick up UI source changes.
- `pnpm dev:both` — run `pnpm dev` and `pnpm dev:mobile` together with prefixed output and shared signal handling.

The preview server binds `0.0.0.0` and accepts any Host, so a tailnet or LAN address (e.g. `http://<host>.ts.net:3101/`) works out of the box. The `/api` proxy sets `x-forwarded-host` and `x-forwarded-proto`, which the server's board mutation guard uses to trust the browser's Origin — mutations from `:3101` succeed against the API on `:3100` without further configuration. An HTTPS tunnel in front of the preview server (ngrok, tailscale funnel) is also supported: the tunnel's `x-forwarded-proto` header is preserved when set.

Static UI mode compresses built JavaScript, CSS, and HTML with Brotli or gzip
when the browser supports it. Hashed assets retain their immutable cache policy;
byte-range responses retain their original representation. This reduces initial
page downloads through bandwidth-limited HTTPS tunnels such as Tailscale Funnel.
API responses and MCP transports keep their existing compression behavior.

## Quick Health Checks

In another terminal:

```sh
curl http://localhost:3100/api/health
curl http://localhost:3100/api/companies
```

Expected:

- `/api/health` returns `{"status":"ok"}`
- `/api/companies` returns a JSON array

On `*.staging.paperclip.app`, the account menu shows the running server's
short commit SHA below the user's email. Hover over it for the full SHA,
or follow the link to inspect the commit on GitHub.
Opening the menu refreshes `/api/health` so the label reflects recent deploys.
The label is hidden on other hosts and when commit metadata is unavailable.

## One-Command Local Run

For a first-time local install, you can bootstrap and run in one command:

```sh
pnpm penclip run
```

> **Note: private npm registry `.npmrc` + first-run onboarding**
>
> The first-run experience often starts with `npx penclip onboard --yes` (before you have a repo checkout). If your global `~/.npmrc` sets `registry` to a private registry (for example GitHub Packages), `npx` may try to resolve `penclip` from that private registry and fail with `E404`.
>
> Diagnostic:
>
> ```sh
> npm config get registry
> ```
>
> Workaround (cross-platform; force the public npm registry for this command):
>
> ```sh
> npx --registry https://registry.npmjs.org penclip onboard --yes
> ```

`penclip run` does:

1. auto-onboard if config is missing
2. `penclip doctor` with repair enabled
3. starts the server when checks pass

### One-command isolated manual test drive

Use `test-drive` when you want to exercise the UI from a fresh checkout or SHA
without completing onboarding by hand:

```sh
ANTHROPIC_API_KEY=... node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive
OPENAI_API_KEY=... node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive --harness codex --model gpt-5.4
OPENROUTER_API_KEY=... node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts test-drive \
  --harness opencode \
  --model openrouter/anthropic/claude-sonnet-4.5
```

The command creates a trusted-loopback instance in a unique OS temporary data
directory, prints the absolute directory, runs onboarding and doctor
non-interactively, creates `Test Company` with a `CEO` agent, then opens the
browser. It runs in the foreground, does not install a background service, and
does not create a goal, project, issue, task, or first heartbeat. Temporary
directories are retained for inspection. Use `--data-dir <path>` to reuse one
or `--no-browser` to suppress browser opening. Reused directories must use the
embedded database: the command rejects database URL environment overrides and
configs with `database.mode: postgres`, suppresses the invocation directory's
`.env` when the server starts, and keeps the normal managed-service collision
guard. The selected instance's own environment file still loads. The command
selects the first available loopback port at or above `3100`.

Source-checkout startup builds the shared and plugin SDK packages when needed
and prints build progress. The command stays in the foreground after printing
its ready URL; use Ctrl-C to stop it. An interrupted build is detected and
rebuilt on the next start.

Claude uses `ANTHROPIC_API_KEY`; Codex uses `OPENAI_API_KEY`; OpenCode uses
`OPENROUTER_API_KEY` and requires an `openrouter/...` model. `--api-key-env`
can name a different source variable while the agent still receives the
canonical variable. `--api-key <value>` is also supported and is mutually
exclusive with `--api-key-env`; Paperclip redacts it from its own output, but
also removes it from the JavaScript argument view before telemetry, diagnostics,
or server startup. Wrappers, operating-system process listings, and shell
history may still expose argument values. This is an explicit local test-drive
tradeoff; use an environment-backed input when that exposure is not acceptable. In a
linked Git worktree the command sets worktree runtime mode and safely arms
**Run tasks in this worktree** for the current isolated instance. Primary
checkouts and non-Git directories leave that experimental setting unchanged.

If the selected data directory already contains any company, `test-drive`
preserves all companies, agents, and secrets and ignores the bootstrap flags.
The worktree execution setting is the only value it may reconcile in that
case.

## Docker Quickstart (No local Node install)

Build and run Paperclip in Docker:

```sh
docker build -t paperclip-local .
docker run --name paperclip \
  -p 3100:3100 \
  -e HOST=0.0.0.0 \
  -e PAPERCLIP_HOME=/paperclip \
  -v "$(pwd)/data/docker-paperclip:/paperclip" \
  paperclip-local
```

Or use Compose:

```sh
docker compose -f docker/docker-compose.quickstart.yml up --build
```

See `doc/DOCKER.md` for API key wiring (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) and persistence details.

## Docker For Untrusted PR Review

For a separate review-oriented container that keeps `codex`/`claude` login state in Docker volumes and checks out PRs into an isolated scratch workspace, see `doc/UNTRUSTED-PR-REVIEW.md`.

## Local Instance Layout

Every local install keeps runtime state directly under the selected instance root:

```text
~/.paperclip/instances/default/                  # instance root
  config.json                                    # runtime config
  .env                                           # instance env file
  db/                                            # embedded PostgreSQL data
  data/
    storage/                                     # local_disk uploads
    backups/                                     # automatic DB backups
  logs/
  runtime-services/                             # managed local-service registry
  runtime-service-logs/                         # append-only managed-service stdout/stderr
  secrets/master.key                             # local_encrypted master key
  workspaces/<agent-id>/                         # default agent workspaces
  projects/                                      # project execution workspaces
  companies/<company-id>/agents/<agent-id>/codex-home/
                                                   # per-agent codex_local home
```

`PAPERCLIP_HOME` and `PAPERCLIP_INSTANCE_ID` override the home root and instance id respectively. `penclip onboard` echoes the resolved values in its banner (`Local home: <home> | instance: <id> | config: <path>`) so you can confirm where state will land before continuing.

Config updates preserve unrecognized top-level and nested keys so provider or
plugin extensions survive `configure` and worktree port repair. Likely
misspellings of known keys produce a warning but are not removed. If an
existing `config.json` is malformed, `onboard` and `configure` first create a
byte-for-byte sibling backup named `config.json.invalid-1` (then `-2`, and so
on). Repair from defaults requires an interactive confirmation; non-interactive
runs stop without replacing the original.

## Database in Dev (Auto-Handled)

For local development, leave `DATABASE_URL` unset.
The server will automatically use embedded PostgreSQL and persist data at:

- `~/.paperclip/instances/default/db`

Override home or instance:

```sh
PAPERCLIP_HOME=/custom/path PAPERCLIP_INSTANCE_ID=dev pnpm penclip run
```

No Docker or external database is required for this mode.

## Reset Local Dev Database

To wipe local dev data and start fresh:

```sh
rm -rf ~/.paperclip/instances/default/db
pnpm dev
```

## Optional: Use External Postgres

If you set `DATABASE_URL`, the server will use that instead of embedded PostgreSQL.

## Storage in Dev (Auto-Handled)

For local development, the default storage provider is `local_disk`, which persists uploaded images/attachments at:

- `~/.paperclip/instances/default/data/storage`

Configure storage provider/settings:

```sh
pnpm penclip configure --section storage
```

## Secrets in Dev

Agent env vars support secret references. By default, secret values are stored with local encryption and only secret refs are persisted in agent config.

- Default local key path: `~/.paperclip/instances/default/secrets/master.key`
- Override key material directly: `PAPERCLIP_SECRETS_MASTER_KEY`
- Override key file path: `PAPERCLIP_SECRETS_MASTER_KEY_FILE`
- Back up the key file and database together; either one alone is not enough to restore local encrypted secrets.

Strict mode (recommended outside local trusted machines):

```sh
PAPERCLIP_SECRETS_STRICT_MODE=true
```

When strict mode is enabled, sensitive env keys (for example `*_API_KEY`, `*_TOKEN`, `*_SECRET`) must use secret references instead of inline plain values.
Authenticated deployments default strict mode on unless explicitly overridden.

CLI configuration support:

- `pnpm penclip onboard` writes a default `secrets` config section (`local_encrypted`, strict mode off, key file path set) and creates a local key file when needed.
- `pnpm penclip configure --section secrets` lets you update provider/strict mode/key path and creates the local key file when needed.
- `pnpm penclip doctor` validates secrets adapter configuration, can create a missing local key file with `--repair`, and reports missing AWS Secrets Manager bootstrap env when that provider is selected.
- Provider health is available at `GET /api/companies/:companyId/secret-providers/health` and reports local key permission warnings plus backup guidance.

Per-company provider vaults are configured in the board UI under
`Company Settings → Secrets → Vaults`, backed by
`/api/companies/{companyId}/secret-provider-configs`. The CLI does not own
vault lifecycle today. See `docs/deploy/secrets.md` (`Provider Vaults` section)
for the operator model.

Migration helper for existing inline env secrets:

```sh
pnpm secrets:migrate-inline-env         # dry run
pnpm secrets:migrate-inline-env --apply # apply migration
```

## Deployment Modes

For mode definitions and intended CLI behavior, see `doc/DEPLOYMENT-MODES.md`.

For sandbox file synchronization, lock ownership, and the required upgrade
procedure from directory locks, see [Workspace restore locks](workspace-restore-locks.md).

Current implementation status:

- canonical model: `local_trusted` and `authenticated` (with `private/public` exposure)

## Worktree-local Instances

When developing from multiple git worktrees, do not point two Paperclip servers at the same embedded PostgreSQL data directory.

Instead, create a repo-local Paperclip config plus an isolated instance for the worktree:

```sh
penclip worktree init
# or create the git worktree and initialize it in one step:
npx penclip worktree:make paperclip-pr-432
```

This command:

- writes repo-local files at `.paperclip/config.json` and `.paperclip/.env`
- creates an isolated instance under `~/.paperclip-worktrees/instances/<worktree-id>/`
- when run inside a linked git worktree, mirrors the effective git hooks into that worktree's private git dir
- picks a free app port and embedded PostgreSQL port
- disables automatic database backups for the isolated instance
- by default seeds the isolated DB in `minimal` mode from the current effective Paperclip instance/config (repo-local worktree config when present, otherwise the default instance) via a logical SQL snapshot

Seed modes:

- `minimal` keeps core app state like companies, projects, issues, comments, approvals, and auth state, preserves schema for all tables, but omits row data from heavy operational history such as heartbeat runs, wake requests, activity logs, runtime services, and agent session state
- `full` makes a full logical clone of the source instance
- `--no-seed` defers database copying until the worktree is first used
- `--empty` creates an empty isolated instance, with fresh signing secrets and no deferred copy; use this for synthetic test drives

`--empty` persists a `.paperclip/seed-empty` marker before writing the instance config.
The CLI and managed runtime provisioner honor it even when a registered source
instance is present. An explicit successful `worktree reseed`, or a replacement
`worktree init --force` without `--empty`, clears the choice.
While that marker exists, startup uses the instance's saved JWT and tool-action
signing keys even if the shell inherited another instance's keys. Better Auth
uses its saved key or the fresh instance JWT key. Missing saved keys stop startup.

Seeded worktree instances quarantine copied live execution by default for both `minimal` and `full` seeds. During restore, Paperclip disables copied agent timer heartbeats, resets copied `running` agents to `idle`, blocks and unassigns copied agent-owned `in_progress` issues, and unassigns copied agent-owned `todo`/`in_review` issues. This keeps a freshly booted worktree from starting agents for work already owned by the source instance. Pass `--preserve-live-work` only when you intentionally want the isolated worktree to resume copied assignments.

The same quarantine stops copied project/execution-workspace runtime desired states and clears copied runtime process claims. Without this reset, booting the cloned Paperclip database could restart a source workspace's dev service from the isolated instance, creating duplicate runners, port reassignment, and stale public URLs.

After `worktree init`, both the server and the CLI auto-load the repo-local `.paperclip/.env` when run inside that worktree, so normal commands like `pnpm dev`, `penclip doctor`, and `penclip db:backup` stay scoped to the worktree instance.

`pnpm dev` fails fast in a linked git worktree when `.paperclip/.env` is missing, instead of silently booting against the default instance/port. If that happens, run `penclip worktree init` in the worktree first.

See [the worktree reference](worktrees.md) for deferred seeding, reseeding,
repair, and every `penclip worktree` option.

## Test Commands

The [feature map](../maps/feature-map/README.md) is an optional reference for user
entry points, targeted tests, manual verification recipes, and coverage gaps.
Its generated page inventory lists current source references. The documented journeys have separate
verification steps and do not run automatically from the map.

The sibling [agent access map](../maps/agent-access-map/README.md) describes API
and agent reachability for the same capabilities. The [map contract](../maps/README.md)
defines synchronization, permissions and evidence. After map edits, run
`node scripts/check-maps.mjs` for structural/reference checks; it does not start an
instance or qualify access as an agent.

### Agent worktree preflight

Prepare a new or updated agent worktree with one command:

```sh
node scripts/agent-preflight.mjs
```

It does what `pnpm install --frozen-lockfile`, the plugin SDK's `ensure-build-deps`,
the Runner's `ensure:eval-build-deps`, `build:rust`, `build` and
`build:runner-binaries` did, and skips work whose inputs are unchanged:

- **install** is skipped when the lockfile, every `package.json`, `patches/`, Node
  and pnpm match this worktree's last install.
- **plugin SDK build** runs `scripts/ensure-plugin-build-deps.mjs`, which builds
  `@penclipai/plugin-sdk` and its `@penclipai/shared` dependency and skips
  them when their content fingerprints match the last build. Like the Runner and
  the eval kernel, the SDK is imported through its built `dist` (plugin workers
  load it under plain Node), so the server and the restart-chaos harness cannot
  start without it. Both compile in about two seconds, so they do not use the
  shared cache.
- **Runner build** is skipped when the Runner's build stamp is current. When another
  worktree built the same inputs (the build-input digest described under
  [Reused Runner build in the server build](test-infrastructure.md#reused-runner-build-in-the-server-build),
  plus the compiler), the Runner and eval
  kernel `dist` are cloned from the shared cache. A restore skips the build's lint
  checks; CI runs them.
- **Runner debug binaries** (`runner/target/debug`) are reused the same way, keyed
  by every file the Rust build reads.
- A worktree without `runner/target` starts from a clone of a shared cargo seed
  that holds only third-party crates, so cargo compiles only the Runner crate.

The cache lives in `~/.cache/paperclip/agent-build` (`PAPERCLIP_AGENT_CACHE_DIR`
moves it, `PAPERCLIP_AGENT_CACHE=0` or `--no-cache` turns it off). Entries are
keyed by content and toolchain, never by path or mtime, are written once with an
atomic rename, and are restored as APFS clones, so concurrent worktrees can share
them. The seed never holds the Runner crate: cargo records its out-of-package
includes by absolute path, so units from another checkout cannot be trusted. Keep
the cache on the worktrees' volume so clones stay cheap. `--explain` prints each
step's decision; `--skip-rust-debug` skips the debug binaries.

Do not share `CARGO_TARGET_DIR` between worktrees: cargo serializes builds on its
lock, and the Runner crate's absolute-path dependency records would make one
worktree's freshness check read another's files. The preflight disables the cache
when `CARGO_TARGET_DIR` is set.

### Incremental local verification

Use the local verification entry point for ordinary issue work:

```sh
pnpm verify
pnpm verify --explain
pnpm verify --base origin/master
```

The command compares the actual working tree with the merge base of the supplied
local ref, including committed, staged, unstaged, deleted, renamed, and untracked
paths. The default ref is local `origin/master`, falling back to `master`; it does
not fetch. Tests read the current working-tree bytes. CI must still verify the
final committed revision. The task/input policy, conservative import and file-read
graph, exact Vitest specifications, and stable test runner are shared with CI.
Serialized server tests retain their owner. Native server tests remain in local
coverage. Selected chat tests retain six sequential isolated line shards.

When the change touches `packages/shared/src`, `packages/plugins/sdk/src`, or an
SDK build input such as `pnpm-lock.yaml`, the command first checks the committed
SDK public input pins (`tests/runner-e2e/source-sdk-public-inputs.json`) against
the working tree. If they are stale it exits 1 and prints the refresh command:
commit the change, run
`node tests/runner-e2e/source-sdk-public-inputs.mjs $(git rev-parse HEAD) --write`,
and commit the updated registry. Otherwise the Runner support suite fails in CI.

Successful selected checks with complete input graphs are reusable in this
worktree. Opaque filesystem, subprocess, network, generated/untracked-module, and
unreviewed dependency consumers continue to run fresh. A selected pass never
satisfies a full run. Non-isolated projects and uncertain selection require broader
verification. The command prints the local test scope and remaining CI lanes.

An unchanged repeat can reuse both graph discovery and passing checks. Keys include
actual tracked and non-ignored file contents (including dirty and untracked files),
the shared audited-prose exclusions, dotenv files, lockfile, installation metadata,
dependency bindings and installed package contents, the complete effective child environment, Node/pnpm/Rust toolchains,
platform, checkout path, comparison, and selection. Values from the environment
are hashed, not written to results. External database/live-test settings and
out-of-checkout source symlinks disable reuse. Cache state lives under the ignored
`.turbo/local-verify/` directory and is not shared across worktrees or machines.
Installed package content digests are memoized against file identity, size, mode,
and nanosecond modification/change times; every check rescans the installation.
Generated Vite/cache directories are excluded. The first run after installation
reads package contents; unchanged repeats avoid reading those bytes again.
`last-run.json` retains the latest completed execution's status and scope. Failed/interrupted
attempts do not publish passes. Inputs changed during a run invalidate its result.

Exit 2 reports a broad input, incomplete graph, or unsupported selection. It does
not silently launch the full suite or claim affected coverage passed. Use focused
checks and required CI to close that gap, or explicitly request a broad local run:

```sh
pnpm verify --full
pnpm verify --no-cache
```

`--full` executes the complete existing Vitest path with fresh integration coverage.
`--no-cache` bypasses pass/plan reuse and does not save passes. A fresh failed or
interrupted attempt removes its old reusable pass. Required CI on the final tested
revision may supply broad typecheck/build/test coverage for a PR handoff; do not
repeat a full local suite solely because a chat resumed or a PR is ready. Keep
release checks and any real browser, provider, local-platform or acceptance proof.

The full local Vitest commands remain available:

```sh
pnpm test
```

`pnpm test` runs the Vitest suite only. Its default chat integration coverage runs
first in six sequential, exact-cover child processes, each with its own home,
config and embedded PostgreSQL. The remaining server invocation excludes that
chat file once and retains the native Runner suites. This bounds shared fixture
and process lifetime without increasing concurrency or changing case assertions
or timeouts. An explicit `PAPERCLIP_TEST_DATABASE_URL` retains the original
single, serial database path. Explicit `--group` invocations and CI shard routing
are unchanged.

For interactive Vitest watch mode use:

```sh
pnpm test:watch
```

Browser suites stay separate:

```sh
pnpm test:e2e
pnpm test:release-smoke
```

These browser suites are intended for targeted local verification and CI, not the default agent/human test command.

The default E2E configuration builds the UI into `server/ui-dist` before starting
its throwaway instance and serves that build with
`PAPERCLIP_UI_DEV_MIDDLEWARE=false`. This exercises the
shipped assets, including service-worker takeover and reload, without traversing
the development server's unbundled module graph on each navigation. Browser
assertion deadlines and retries remain unchanged. Use `pnpm dev` separately when
verifying Vite/HMR behavior.

Run `pnpm test:e2e:fixtures` to check the in-feed Codex protocol fixtures without
starting the app or calling a provider. The Node tests cover interrupted turns,
tool replies, and the fixture's completion contract. These tests are separate
from Vitest and Playwright discovery.

For normal issue work, start with the smallest targeted check that proves the change.
Use the incremental command above and required final-revision CI for PR handoff.
Run broad local checks when an unresolved risk or explicit qualification needs them.

### Translation catalog maintenance

The production English and zh-CN `common.json` files are generated runtime
resources. Edit paired entries under `ui/locales-src/` instead, then build and
check the catalog:

```sh
pnpm i18n:build
pnpm check:i18n
```

`i18n:build` validates sources and writes the sorted UTF-8/LF resources.
`check:i18n` is read-only; it fails when generated resources are stale or an
English value has not been explicitly reviewed. After reviewing a changed
English string, record only that key and rerun the commands:

```sh
pnpm i18n:review -- --key <exact-key>
pnpm i18n:build
pnpm check:i18n
```

Each entry contains `en`, `zh-CN`, and `reviewedEnglishHash`. Semantic keys are
owned by `ui/locales-src/semantic/domain-<first-prefix-lowercase>.json`; other
source-text keys are owned by
`ui/locales-src/source-text/<first-ascii-letter-lowercase-or-other>.json`.
Keys have one owner; duplicate definitions and implicit overrides fail. Do not
hand-edit `ui/public/locales/*/common.json`.

The small upstream `translation` resources are separate from the production
catalog and retain their own tests. For sync-fork-specific auditing and wording
rules, see the [CN localization policy](../.agents/skills/paperclip-cn-fork-maintenance/references/ui-localization-policy.md).

For missing-copy investigations, combine the binding-aware key audit with the
read-only visible-text inventory and an isolated browser pass:

```sh
pnpm audit:i18n-visible -- --out .omx/i18n-browser-audit/visible-before.json
pnpm test:i18n
pnpm test:e2e:i18n
```

The visible inventory is a review aid, not a zero-English gate. Classify each
candidate's owner before changing it; user content, technical identifiers and
third-party descriptions remain verbatim. New shared or interpolated messages
use semantic keys, including i18next's `_one`/`_other` suffixes for plural copy.
Resolve translated metadata at render time, or include the active language in
memo dependencies, so switching languages preserves drafts and refreshes labels.
The E2E smoke starts a disposable instance and checks language switching and raw
user content. Full route/dialog coverage is recorded separately using the
[browser audit checklist](../.agents/skills/paperclip-cn-fork-maintenance/references/browser-i18n-audit.md).

## Storybook

The board UI Storybook keeps stories and Storybook config under `ui/storybook/` so component review files stay out of the app source routes.

Stories are grouped in `ui/storybook/stories/<feature-area>/`. Feature recipe
navigation controls the sidebar. Shared fixtures live in `ui/storybook/support/`.
Keep each suite's explicit meta `id` when changing titles or locations so existing
review links remain valid. Author capability associations, implementation/data
classification and durable limitations in the story's `parameters.paperclip`.

Storybook start/build generates the catalog, feature Overview pages, and literal
sidebar order from the checked-out sources. `ui/storybook/generated/` and
`ui/storybook/.storybook/preview.tsx` are ignored build outputs. Shared preview
fixtures and decorators live in `preview-base.tsx`; generation never edits it.
UI typechecking also generates the inputs on a fresh checkout.

Run `node scripts/storybook-catalog.mjs` to assemble the local Markdown indexes,
verification routes and page inventory under `maps/generated/`. Use `--check`
for validation without writes. These outputs are not committed. Use Git diffs to
select affected sources for review; do not maintain review fingerprints or append
a shared review journal. Record executed evidence in the PR, issue, or CI result.

The [Storybook map contract](../maps/storybook-map/README.md) describes annotations
and the [published guide](https://d1p6rlowie26tp.cloudfront.net/storybook/branches/master/?path=/story/overview-storybook-guide--coverage-guide).
Use `maintain-storybook` for source alignment and `review-storybook` for rendering
and interactions. Generated guides, example counts and structural checks do not
establish production behavior. Feature recipes retain optional verification
scope guidance; the feature/access structural check needs no Storybook runtime.

```sh
pnpm storybook
pnpm build-storybook
```

These run the `@penclipai/ui` Storybook on port `6006` and build the static output to `ui/storybook-static/`.

Run one story suite's browser checks against a running Storybook with:

```sh
STORYBOOK_TEST_BASE_URL=http://localhost:6006 pnpm exec playwright test <name>.spec.ts --config=tests/storybook-visual/playwright.config.ts --project=stories
```

To publish a branch's Storybook, see
[Publish a branch Storybook](STORYBOOK-DEPLOYMENT.md#publish-a-branch-storybook).

The Storybook visual regression suite uses external PNG baselines instead of
committed screenshots:

```sh
pnpm test:storybook-visual
pnpm test:storybook-visual:update
```

`pnpm test:storybook-visual` downloads and verifies the baseline archive from
`tests/storybook-visual/baseline-manifest.json` before running Playwright.
Accepted visual changes should update the manifest metadata and publish a new
immutable archive with `pnpm storybook-visual:baseline pack` and
`pnpm storybook-visual:baseline upload`; do not commit generated PNG snapshots.

Known limitation: Storybook visual baselines are Linux/Ubuntu-only. The manifest
pins the capture environment to `ubuntu-24.04` and the Playwright suite uses
pixel-exact comparison, so local runs on macOS, Windows, or other non-matching
platforms can report false-positive diffs from font rasterization and subpixel
rendering. Use the `Storybook Visual` GitHub Actions workflow on `ubuntu-latest`
as the source of truth, or run locally in a matching Linux environment before
accepting or updating baselines.

PR visual checks are opt-in while the suite stabilizes. Add the
`storybook-visual` label to a PR, or run the `Storybook Visual` GitHub Actions
workflow manually, to produce downloadable Playwright report/test-result
artifacts. Normal PR visual runs use read-only repository permissions and do not
upload or mutate baseline objects.

## CLI Client Operations

Paperclip CLI includes client-side control-plane commands in addition to setup commands.

Quick examples:

```sh
npx penclip issue list --company-id <company-id>
npx penclip issue create --company-id <company-id> --title "Investigate checkout conflict"
npx penclip issue update <issue-id> --status in_progress --comment "Started triage"
```

Set defaults once with context profiles:

```sh
npx penclip context set --api-base http://localhost:3100 --company-id <company-id>
```

Then run commands without repeating flags:

```sh
pnpm penclip issue list
pnpm penclip dashboard get
```

See full command reference in `doc/CLI.md`.

## Desktop Packaging & Windows

### Desktop deployment isolation

`prepare-stage.mjs` copies the server's required workspace packages into
`.stage/deploy-workspace` before it runs pnpm's production deployment. Root
lifecycle scripts and patch inputs are copied with the manifests. The copy
includes workspace development references needed for pnpm resolution, but the
final runtime still uses `deploy --prod`. Local agent state, dependencies,
Rust targets, caches, and test reports do not enter the copy. Package ignore
files remain available so pnpm can apply the package's normal publish rules.

Keep the hoisted deploy and its temporary patch allowance inside that copy.
Running pnpm 9's hoisted deploy against the live workspace can replace AI SDK
dependency junctions with incomplete physical directories. An isolated linker
is not a substitute for this boundary: its dependency links can be expanded by
the NSIS archive and change the installed path lengths. After packaging, check
the source dependency junctions and imports as well as the packaged runtime.

### Desktop background behavior

The desktop window closes to the system tray by default when a usable tray is
available. Closing the window keeps the local service and tasks running, including
provider usage. The first close explains this behavior. Use the tray menu or the
desktop section in Profile settings to change it or quit. Opening a second instance
restores the existing window. If a tray cannot be created, closing requests an
explicit quit instead of leaving an inaccessible background process.

Ready-state quit requests explain their impact and let the user continue running.
A fresh positive task summary gives a lower bound for the current company only;
unavailable state is shown as unknown. Confirmation uses the existing graceful
worker shutdown, with visible progress. It does not introduce a new provider
cancellation policy: some remote or native work may continue and must be
reconciled after reopening. Windows session ending bypasses the normal
hide/confirmation flow without vetoing OS shutdown.

Window bounds, maximized state, and the last safe application pathname are stored
with theme and tray preferences in `desktop-preferences.json` under the desktop
user-data directory. Authentication/pairing routes, query strings, and fragments
are excluded. Restoration clamps the window into a current display's work area.
On Windows, a bounded native bounds check also compensates for fractional-DPI
rounding before the window is shown or maximized. It stops when native minimum
sizes prevent further correction; no background resize polling is introduced.

Important native notifications reuse the existing company-scoped live-event and
toast eligibility rules. They show only fixed approval/failure/timeout messages
while the window is hidden or unfocused; titles, errors, comments, and agent output
stay inside the application. Desktop mode keeps its existing live socket while
hidden; ordinary Web page visibility behavior is unchanged. Native notification
support and OS delivery settings vary by platform, desktop environment, and app
signing, so the in-app inbox remains the place to inspect details.

Native text is authored only in `ui/locales-src/semantic/domain-desktop.json`.
Run `pnpm i18n:build` after editing reviewed bilingual source. The desktop build
packages the `desktop.*` subset of the generated catalog as
`dist/desktop-locales.json`; missing or mismatched messages fail the build.

Run `pnpm smoke:desktop:background` for a focused real Electron lifecycle check.
It uses an isolated profile and worker on the caller's temporary drive; set
temporary/home/cache environment paths to the intended test drive before launch.
For Windows acceptance that must stay on D:, use a dedicated PowerShell session
with the following environment. The drive guard fails before building or creating
a profile when the temporary or evidence path is on another drive; the existing
desktop smoke/acceptance launchers honor the same environment guard.

```powershell
$desktopSmokeRoot = "D:\paperclip-desktop-smoke"
New-Item -ItemType Directory -Force -Path "$desktopSmokeRoot\temp", "$desktopSmokeRoot\home", "$desktopSmokeRoot\cache", "$desktopSmokeRoot\home\appdata", "$desktopSmokeRoot\home\localappdata" | Out-Null
$env:TEMP = $env:TMP = $env:TMPDIR = "$desktopSmokeRoot\temp"
$env:HOME = $env:USERPROFILE = "$desktopSmokeRoot\home"
$env:APPDATA = "$desktopSmokeRoot\home\appdata"
$env:LOCALAPPDATA = "$desktopSmokeRoot\home\localappdata"
$env:npm_config_cache = "$desktopSmokeRoot\cache"
$env:PAPERCLIP_DESKTOP_SMOKE_REQUIRED_DRIVE = "D:"
pnpm smoke:desktop:background --artifact-dir "$desktopSmokeRoot\evidence"
```

`--skip-build` reuses prepared UI/server and desktop outputs. The probe exercises
actual window hiding, restoration, preferences, restart, and graceful service
exit with controlled dialog responses. It does not certify physical tray gestures,
OS notification display, or real OS logoff across all supported platforms.

Real Electron smoke launchers pass the isolated profile through the native
`--user-data-dir` switch as well as `PAPERCLIP_DESKTOP_USER_DATA_DIR`: bootstrap
reads Electron's path before the application's override is applied. Their cleanup
confirms the normal quit dialog inside the isolated test process so unattended
checks still exercise graceful shutdown after the new user-facing quit gate.

### Windows desktop installer extraction

The NSIS installer keeps the default 7z archive. The bundled runtime has more
than 65,535 archive entries; its ZIP alternative is ZIP64, which the current
NSIS ZIP plugin rejects with `Error opening ZIP file`.

The installer automatically handles long inherited temporary paths with
`packages/desktop-electron/assets/installer.nsh`. Before electron-builder's
mutex and UAC initialization, it creates an exclusive random short directory on
the inherited TEMP drive and restarts the same installer with TEMP/TMP pointing
there. The directory requires a local fixed drive with persistent Windows ACLs;
its protected, inheritable permissions allow only its owner, administrators and
SYSTEM. Extraction and the old-version uninstaller share the short environment.
Before the installed application starts, the installer restores the original
TEMP/TMP. The waiting parent forwards the child's exit code and removes only
the directory it created. No global environment settings change.
Empty original values are restored as missing variables, rather than empty
strings. Separate nonempty TEMP and TMP values are restored independently.

Keep the final installation path short as well. Network/removable temporary
drives, unwritable drive roots, and inherited TEMP paths over 200 characters
require a manually selected short local directory: the parent still needs to
load NSIS's System plugin before restarting. These cases fail before payload
installation with exit code 1603. From PowerShell, set `$env:TEMP` and `$env:TMP`
to a dedicated short directory on the intended drive before launching the
installer. Do not move temporary data from D: to C: as a workaround. Independent
uninstallers retain electron-builder's default behavior; this hook covers new
installations and the old-version uninstaller invoked during an upgrade.
In a controlled environment that must keep temporary files on one drive, run
all-users installation from an elevated shell with explicit TEMP/TMP values.
The stock UAC plug-in does not explicitly transfer the calling process's
environment to its elevated instance. Passing the per-user checks does not
prove the ordinary installer's UAC handoff respects that drive constraint.

Run the small Windows NSIS regression probe before a full packaging run:

```powershell
pnpm --filter @penclipai/desktop-electron test:nsis-temp --makensis <cached-makensis.exe> --work-dir D:\desktop-nsis-qa
```

The probe compiles and executes the real hook, checks deep staging paths,
preserves `/D` arguments containing spaces, and verifies exit-code propagation,
TEMP/TMP restoration, cleanup, and the build-time uninstaller bypass. It keeps
its evidence under the explicit work directory. The default suite also tests
14/200-character paths, the 201-character failure boundary, missing TMP, and
empty TEMP with a native Windows path preflight. A controlled short child tests
restoration when both original values are empty. Full startup combinations
that lack a safe same-drive preflight are listed in `summary.skipped`; they are
not counted as passed. The Windows PR job runs this same default suite and
uploads its evidence. It does not replace full-payload installation, data
retention, or interactive UAC checks.

Windows uses `normal` compression; record the actual installer size in the
desktop size audit when comparing releases.

### Desktop runtime payload and size budgets

Desktop staging retains the OpenCode native package selected by the Runner:
Linux glibc x64 and macOS x64 use their baseline CPU packages, and macOS arm64 uses
its native package. Other OpenCode variants are removed only from the staged
runtime. When the portable executable contains the same bytes, staging replaces
it with a relative symlink to the selected native executable. Its existing
entrypoint remains available. Linux staging rejects musl or an unknown libc
before trimming files. Windows payloads and other providers are preserved.

The Electron-only staged copy omits generated `.js.map` and `.d.ts.map` files
from first-party bundled plugin UI directories only when a matching regular
JavaScript or declaration file ends with the exact
`//# sourceMappingURL=<map filename>` marker. It removes that marker before
deleting the map. Other maps stay in place. Source trees, published plugin
packages, plugin runtime code and assets, dependencies, and provider payloads
remain unchanged.

Run the fixture regressions with:

```sh
pnpm --filter @penclipai/desktop-electron test:payload
```

The desktop CI matrix verifies the unpacked application and then mounts the
final DMG read-only or extracts the final AppImage. Each check uses the actual
vendored Runner resolver and executes both OpenCode entrypoints with `--version`
on its Unix host. Native module probes run in a child process so their library
handles close before the verifier unmounts a DMG. Cleanup retries a busy volume
and can force-detach only its own read-only temporary mount. It then runs
`audit:size:check`, which enforces installer and app-runtime budgets for all four
desktop targets. The reviewed baselines live in `scripts/desktop-size-budget.mjs`
within the desktop package. Review measured changes before updating a budget; do
not raise a limit simply to pass a failed build. JSON and Markdown audit
evidence remain available when the budget gate fails. A directory-only local
package can still use `audit:size` without requiring an installer.

Manual desktop workflow runs default to all four targets. Select a single
`target` to repeat a platform check. A failed check retains any completed
installer for seven days as a separate diagnostic artifact; it does not pass
the normal artifact or release-upload gates.

Release uploads require `target=all` and a successful four-target matrix. A
separate upload job checks each downloaded manifest, version, target, and exact
installer filename before staging all four installers and regenerating
`SHA256SUMS.txt`. A failed or missing target prevents the entire upload job.
For an installer-only repair of an existing release, build with its original
`release_version`, retain the old installers and checksums, and validate the
complete replacement cohort before uploading it. GitHub asset replacement is
not atomic, so preserve those backups until public downloads match the new
checksums.

After changing installer packaging, run `pnpm desktop:dist:win`, install the
resulting NSIS executable, and compare every installed runtime file with
`release/win-unpacked` before testing the installed application. An installer exit
code of zero alone does not prove that all bundled dependencies were extracted.

### Windows platform notes

#### Embedded PostgreSQL shutdown on Windows

On Windows, an embedded cluster started by this server stops through the same
runtime's `pg_ctl stop -m fast -w`. The server first checks the owned child PID
and canonical data directory against `postmaster.pid`, retains a native handle
for the verified root process, and then waits for `pg_ctl` and that root to
exit. The `postmaster.pid` marker is read as UTF-8 so Windows system-code-page
defaults cannot change ownership verification for non-ASCII data directories.
Before success it closes only verified direct `postgres --forkchild` children
created during that root's lifetime. An identity mismatch is never
terminated; its held handle gets a short, deadline-bounded chance to exit
naturally, and only a still-live unverified child fails the stop. A failed stop rejects
programmatic shutdown and makes signal-driven shutdown exit with code 1 after
tracing and error reporting flush.
When the owned root has already been proven to exit cleanly, Paperclip detaches
that stale child reference even if later fork-child closure checks fail, so the
dependency's exit hook cannot target a reused PID; the shutdown still fails.
This path does not stop an external database or an embedded cluster reused from
another server.

#### Legacy CLI output encoding on Windows

Local CLI stdout and stderr use independent UTF-8 stream decoders. A character
split across process output chunks is retained until its remaining bytes arrive.
Decoder tails are delivered to the run log before process completion. Existing
stored replacement characters are retained; this does not rewrite run history.

For a legacy `opencode_local` command on Windows whose stderr has a known
non-UTF-8 encoding, set `adapterConfig.stderrEncoding` to a supported
`TextDecoder` label, such as `"gbk"` for a confirmed CP936 producer. This explicit
setting applies only to local Windows stderr. Stdout keeps its UTF-8 JSONL
protocol. Unsupported labels and remote or non-Windows use fail before execution.
The default remains UTF-8. Console language and `chcp` do not reliably identify
the encoding of redirected output, so Paperclip does not guess a code page.

The legacy adapter rejects the official `opencode-ai` postinstall placeholder
before model probing. If this reports an incomplete installation, reinstall the
CLI with its matching platform dependency and the package's installation script
approved through the package manager. Check `opencode --version` before retrying
a task. Paperclip does not repair or replace a user-managed CLI automatically.

Persisted run-log pages carry an `endOffset` byte cursor, including at the
currently available EOF. `nextOffset` still indicates that another page is
available. Consumers resume from the byte cursor rather than JavaScript string
length, so later appended Chinese or emoji records do not replay earlier bytes.

#### Local AI Login Platform Support

Server-hosted subscription login requires a trusted, private instance and a
platform that supports confined credential-file reads. It is unavailable on
Windows; API-key connections remain available. Windows must not advertise local
subscription login until it can enforce the same file-open boundary.

Remote Pi companion import supports macOS and Linux controllers. Windows
controllers reject the import before reading the companion path.

Windows cannot use a negative PID probe as evidence that a process group has
stopped. Native cleanup and dead-runner recovery therefore retain process
identity and wait for ownership evidence when no process-tree retirement
authority is available. A missing direct runner PID does not authorize a
replacement run or physical cleanup.

Windows supports native runtime contexts with no assigned skills. Immutable
assigned-skill snapshots require POSIX directory sealing, so Windows rejects
them before publishing a new skills home or replacing a retained snapshot.
Empty skills homes use nonrecursive directory removal; nonempty homes and
reparse points remain intact and return `native_runtime_context_unsupported`.

Windows Codex runtime homes use a protected DACL owned by the current user SID
before staging or writing config and API-key login state. Foreign ownership and
reparse points are rejected. Host Codex subscription auth cannot be imported on
Windows; use an explicit API key or a managed connection. Managed config reads
are bounded and check final-file identity before and after reading. The
controller must select and trust the source config parent and runtime ancestor;
these checks do not provide kernel-enforced protection against ancestor swaps.

Default remote runner staging requires the controller binary to match the
remote operating system and architecture. A Windows controller targeting a
Linux runner must supply the Linux artifact through
`PAPERCLIP_RUNNER_REMOTE_BINARY_PATH`; build metadata and checksum verification
still apply to that explicit artifact.

Windows self-host cloud connector enrollment uses Windows PowerShell ACL APIs
to protect the instance root, secrets directory, and private identity file for
the current token SID. Reparse points, foreign owners, or ACL failures stop
local identity access. As with POSIX private storage, the operator must control
the pre-existing parent above the instance root. Managed environment identity
overrides do not read or repair local identity storage. POSIX storage retains
its directory `0700` and file `0600` modes.

Windows archive-based workspace transfers prefer GNU tar from the active Git
for Windows installation. It preserves UTF-8 filenames supplied in NUL-delimited
path lists. The helper passes forward-slash local directories to GNU tar's `-C`
option so Windows backslash sequences are not decoded as escapes.
If that tool is unavailable, the system tar remains the fallback;
it can reject Unicode path lists rather than complete the transfer.

#### Local Codex crash replacement on Windows

Local Codex crash replacement requires authenticated proof that the previous
runner and its process group stopped, plus a complete interrupted-turn inventory.
The current Windows controller does not record an owned Job Object/process-tree
stop receipt, so it preserves the task without automatically replaying the failed
run. A dead direct PID or a retained snapshot is insufficient. Windows E2E tests
verify that refusal; the strict replacement journey requires a supported host.

## Fork CI & Lockfile Rules

CN upstream-sync PRs follow the fork-maintenance skill's lockfile ownership
rule: compare the pre-sync baseline, include only changes required by updated
package-manager inputs, and verify with a frozen install.

See [ci-workflows.md](ci-workflows.md) for general CI workflow details. In the CN
fork, `.github/workflows/pr.yml` uses an immutable fork commit pin for trusted
PR execution, and the `paperclip-ci-routing` runner group must authorize only the
fork routing workflow's exact reference rather than an upstream workflow
reference.

## More documentation

Background on how each area works. These can be out of date; the code and its
tests are the source of truth.

| Area | Doc |
| --- | --- |
| Schema, migrations, DB clients | [DATABASE.md](DATABASE.md), [database-backups.md](database-backups.md) |
| CI routing, trusted PR workflow, lockfiles, typecheck lane | [ci-workflows.md](ci-workflows.md) |
| Test tooling internals, typecheck memory, benchmarks, smoke tests | [test-infrastructure.md](test-infrastructure.md) |
| Worktree commands and seeding | [worktrees.md](worktrees.md) |
| Restarts and deploys | [hot-restart-deploys.md](hot-restart-deploys.md) |
| Heartbeat service and background workers | [heartbeat-internals.md](heartbeat-internals.md) |
| Paperclip Runner | [RUNNER-INTEGRATION-PLAYBOOK.md](RUNNER-INTEGRATION-PLAYBOOK.md), [runner-internals.md](runner-internals.md) |
| Workspace directories, repositories, caches | [workspace-repositories.md](workspace-repositories.md) |
| Managed-cloud and remote workspace storage | [workspace-storage.md](workspace-storage.md) |
| Skills and teams catalogs | [skills-and-teams-catalog.md](skills-and-teams-catalog.md) |
| Board UI internals, saved read cache | [ui-internals.md](ui-internals.md) |
| Storybook publishing | [STORYBOOK-DEPLOYMENT.md](STORYBOOK-DEPLOYMENT.md) |
| Cases experiment | [case-handoffs.md](case-handoffs.md) |
| Slack chat in local dev, connector diagnostics | [chat-connector-development.md](chat-connector-development.md) |
| Environment switches and Cloud startup configuration | [instance-configuration.md](instance-configuration.md) |
| Small integration API contracts | [integration-api-notes.md](integration-api-notes.md) |
| Private tasks and projects | [ISSUE-PRIVACY.md](ISSUE-PRIVACY.md) |
| Agent deliverables | [AGENT-ARTIFACTS.md](AGENT-ARTIFACTS.md) |
