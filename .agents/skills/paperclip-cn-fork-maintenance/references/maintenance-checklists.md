# Maintenance Checklists

Use these checklists after mapping the touched diff to the five durable fork concerns. The repository runbooks remain authoritative for exact commands and current implementation details.

## Contents

1. Drift classification
2. Durable fork contract
3. Source localization
4. Windows
5. Electron
6. External adapters
7. Rebrand
8. Scope baseline
9. Verification mapping

## Drift Classification

Classify each meaningful diff bucket as one of:

1. intended durable fork difference
2. compatibility support required by a durable fork concern
3. upstream baseline already present
4. unnecessary or weakly justified fork drift

Before calling a change fork-only, inspect the upstream range and the commit history that introduced it. If upstream already owns the capability, review only the fork-specific delta around it.

For category 4, state whether to revert, trim, or document the change and explain why it falls outside the fork contract.

## Durable Fork Contract

Treat these as the intended long-lived Paperclip CN differences:

1. zh-CN-first UI localization with English switching.
2. Windows-compatible development, build, runtime, and tests.
3. Electron desktop packaging with bounded desktop-specific behavior.
4. External-only installation for Hermes, Droid, and similar third-party adapters.
5. Visible Paperclip CN rebrand without changing stable technical identifiers.

Anything else requires evidence that it is necessary to absorb upstream structure or keep the synchronized branch mergeable and testable.

## Source Localization

For touched UI and application-owned message sources, check:

- hardcoded visible labels, buttons, headings, placeholders, and descriptions
- nested tabs, dialogs, menus, toasts, banners, tooltips, aria labels, and accessible names
- loading, empty, error, permission, retry, disconnected, and archived states
- system notices, activity phrases, run/event panels, and comment interaction cards
- shared enum labels for status, priority, policy, trigger, runtime, and entity types
- stale memoized labels after language switching
- `en` and `zh-CN` key parity and duplicate JSON keys
- merge-touched components where upstream structure may have replaced translated rendering

Use the browser audit for rendered coverage. Use the key audit for static parity and usage evidence. Neither replaces the other.

Do not translate user-authored names, package names, adapter IDs, provider/model IDs, protocol fields, logs, stdout/stderr, paths, URLs, environment variables, or API fields.

## Windows

Inspect touched scripts, runtime helpers, package scripts, and tests for:

- Unix-only shell fragments in cross-platform entrypoints
- raw `rm -rf`, `cp`, `mv`, or `chmod` where repository Node helpers should be used
- command invocation that relies on POSIX quoting or executable resolution
- maintained TypeScript dev/runtime entrypoints drifting from `scripts/run-with-tsx.mjs` or the repository's `node --import tsx` pattern back to unqualified direct `tsx` invocation
- path concatenation that bypasses platform-aware APIs
- symlink creation that should use junction-aware repository behavior on Windows
- path equality tests that should normalize realpaths and platform spelling
- process cleanup, watch, and child-process behavior that differs on Windows
- PowerShell-to-bash environment propagation when release helpers are involved

Prefer existing repository helpers over new wrappers. Keep platform-specific behavior bounded and covered at the helper or route level when possible.

When installer hooks, deployment staging, or elevated execution change, use
[desktop-maintenance.md](desktop-maintenance.md) for same-drive temporary data,
source dependency isolation, and the distinction between NSIS probes and full
installation/UAC/data-retention evidence.

## Electron

Inspect desktop code, shared UI, packaging, scripts, docs, and release automation for:

- Electron-specific behavior leaking into ordinary web paths
- packaged external-adapter installation and package resolution
- user-data and configuration paths remaining distinct from visible brand copy
- shared layout using the Electron-adjusted available height instead of assuming the full viewport
- duplicate document and content scrollbars caused by titlebar-reserved space
- root `desktop:*` aliases drifting from `packages/desktop-electron` scripts
- `doc/DEVELOPING.md` drifting from maintained desktop entrypoints
- desktop smoke coverage for dev, packaged, core acceptance, and full acceptance flows
- stable desktop version injection and asset naming
- supported platform and architecture assets matching `doc/RELEASING.md`
- public desktop assets belonging to a stable release or its explicitly requested installer repair; canary publication must not emit them

Use [desktop-maintenance.md](desktop-maintenance.md) for payload selection,
native final-container checks, size budgets, full-platform upload gates, and
existing Release replacement. Build success, installation success, and a real
agent journey are separate claims; select evidence for the requested scope.

Preserve data-path boundaries:

- Electron default `userData` uses the no-space slug `penclip` under the operating-system app-data root
- expected defaults are `AppData/Roaming/penclip` on Windows, `~/Library/Application Support/penclip` on macOS, and `$XDG_CONFIG_HOME/penclip` or `~/.config/penclip` on Linux
- CLI and server default home remains `~/.paperclip`
- visible product name remains `Paperclip CN`

Do not infer one path contract from another during rebrand or packaging work.

When desktop scripts change, keep root commands and documentation synchronized. Verify the narrow package command first, then the maintained root entrypoint when both are part of the contract.

## External Adapters

Inspect server, UI, manifests, plugin loader, Adapter Manager, desktop packaging, and tests for:

- external adapter packages reintroduced into core workspace dependencies
- hardcoded imports or built-in registrations for external-only adapters
- adapter-specific parser or rendering imports in generic host UI
- install, resolution, enable, disable, override, pause, and resume behavior remaining generic
- packaged Electron resolving the same external package contract as web development
- config schemas exposing generic host controls while preserving raw package and type IDs
- external overrides restoring any shadowed built-in behavior correctly when removed or paused
- package quirks being solved in generic loader or resolution boundaries rather than global hardcoded branches

Hermes, Droid, and similar third-party adapters remain external-only unless product strategy explicitly changes. Runtime-specific onboarding or protocol documentation does not make an adapter a built-in dependency.

When touching OpenClaw Gateway behavior, preserve supported protocol negotiation, challenge nonce/signature correctness, actionable mismatch details, and payload compatibility. Keep protocol fields and gateway logs raw.

## Rebrand

Translate or rebrand application-owned visible copy according to [ui-localization-policy.md](ui-localization-policy.md).

Preserve stable technical contracts:

- npm package names and scopes
- CLI executable names required by the fork contract
- environment variable prefixes
- API fields and serialized identifiers
- filesystem paths whose compatibility is intentional
- upstream URLs, historical quotations, logs, and protocol text when literal fidelity matters

Choose command wording by audience:

- public install, onboarding, and operator snippets use the documented public command
- repository development and maintenance examples retain repository-native commands
- historical output and logs preserve literal text

Do not mechanically replace every occurrence of an upstream brand or command token.

## Scope Baseline

An upstream sync may include:

- the upstream merge
- localization and rebrand restoration required by the fork contract
- Windows, Electron, or external-adapter fixes required for the merged code to work
- focused tests protecting those changes

Do not use the sync as a vehicle for unrelated architecture work, broad style changes, new embedded databases, new worktree behavior, CLI end-to-end suites, or real provision shell tests. Prefer pure functions, helpers, middleware, routes, and services when they protect the same invariant with lower cost.

When an upstream path or runtime contract causes the problem, preserve upstream behavior where possible and contain necessary compatibility at shared/server boundaries instead of copying a workaround into every adapter.

## Verification Mapping

Use the smallest diagnostic check first, then the broad gate required by task scope.

| Concern | Focused evidence |
|---|---|
| localization | locale catalog tests, i18n key audit, affected component tests, browser recheck |
| Windows | `pnpm test:windows-compat` and touched helper/script tests |
| Electron | desktop typecheck/build/pack and applicable smoke entrypoints |
| adapters | loader, registry, route, package-resolution, and packaged desktop tests |
| rebrand | exact searches plus affected UI/docs tests |
| broad sync | upstream merge harness, recursive typecheck, test suite, build |

For UI changes, also run `pnpm check:token-gates`. Report skipped gates and why; do not silently downgrade verification after a fix changes shared behavior.
