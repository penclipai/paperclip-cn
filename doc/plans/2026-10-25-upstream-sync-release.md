# Upstream sync through stable release — 2026-10-25

## Scope and pinned identities

The requested terminal state is a verified public stable Release, including npm,
the source tag, smoke checks, and the supported desktop installer set.

- Repository: `penclipai/paperclip-cn`; upstream remote: `paperclipai/paperclip`.
- Continue PR #174 and `codex/upstream-sync-20261023`; do not create a duplicate
  date-renamed sync PR. The branch date belongs to the previous selected snapshot.
- Starting PR head: `f537d662854ef515e73c718336b12aba0158bb72`.
- Fork master: `e72721ac71768f85b01102b93b96eb8425707d3d`.
- Previous upstream snapshot: `412914cfa78d5abefcc34d3eb8d4bb86e461caac`.
- Selected latest upstream: `08dafde1d65a8f3299237af04df5e2543bb4382d`, committed
  on 2026-10-25 UTC. The new range has 110 commits and about 690 changed files.
- Previous public stable: `v2026.1021.0`.
- Safety ref: `codex/upstream-sync-20261023-safety-20261025`.

All new temporary data belongs under `D:/pc-sync-20261025`: the isolated `src`
checkout, `cache`, `runs`, `evidence`, downloads, test instances, and packaging
stages. The original dirty checkout and existing user database are not fixtures.
`run.mjs` at that root sets isolated homes, caches, and TEMP/TMP and strips host
provider/auth secrets for ordinary verification. Physical UAC, Windows Hello,
and protected environment approval remain their respective human/host gates.

## Merge ownership

Preserve upstream service/module structure, the three new migration receipts and
journal entries, native recovery/query projections, project-access controls,
workspace retention, and Runner provider-pack behavior. Reapply only the CN
contracts: bilingual UI, Windows support, Electron isolation, external-only
Hermes/Droid, and stable `@penclipai/*` / `penclip` identifiers. OpenCode remains
the existing built-in adapter.

Review lanes cover runtime/workspace recovery, tool access and routes, server
regression fixtures, UI configuration/onboarding, project-access/recovery UI,
and native package/protocol boundaries. The merge owner integrates these lanes,
normalizes new imports of known workspace packages, generates locale catalogs,
and owns final verification. No whole-file `ours`/`theirs` resolutions.

The incoming range does not change release workflows or public package
manifests. The 15 new lockfile lines come from upstream's CI-owned lock refresh;
keep that input and use a frozen install.

## Verification and release gates

1. Record the pre-merge catalog and static key baseline. Resolve merge conflicts,
   rebuild paired catalogs from stable semantic owners, and compare the post-merge
   snapshot. Audit new visible project-access, gateway, and recovery copy.
2. Run focused conflict/regression tests, then typecheck, tests, and build at the
   scope required for the release. Keep real Windows limits and platform skips
   explicit; a retry does not erase a material failure.
3. Complete independent review, push to PR #174, and inspect only the new head's
   checks. Update the full PR template and clear draft when ready for merge.
4. Qualify the installed Windows runtime and a bounded authorized Grok task.
   Check close-to-tray, restore, native notifications where supported, graceful
   quit/reopen, artifacts, and run logs. Build/probe the full supported installer
   matrix and retain hashes and version identity. Packaging stays inside staging.
5. Merge the verified PR and verify the exact master SHA's canary publication and
   smoke. Promote that source through nightly and Beta with required environment
   approvals. Reconcile package/trust inventory without refreshing credentials
   unless publication actually requires it.
6. Draft and review stable notes for the chosen Beta source. Preserve the normal
   72-hour Beta observation period; do not infer a bypass from the general request
   to release. Prepare stable dry-run and desktop artifacts during the wait.
7. Publish stable after its gates, then verify every release-enabled package,
   dependency closure, remote tag, GitHub Release, exact-version smoke, all desktop
   files and checksum, and actual public downloads. Record signing status for this
   release. Do not replace older application installers with new application bits.

## Evidence index

Detailed credential-free receipts live in `D:/pc-sync-20261025/runs/<label>/`.
The reconciliation and channel checkpoint belongs under the root's `evidence/`
directory; it indexes authoritative remote state rather than replacing read-back.

- `pre-sync-i18n-check`: passed.
- `pre-sync-key-snapshot`: failed because the fresh worktree had no TypeScript
  dependency yet. No merge occurred on that attempt.
- `pre-sync-key-snapshot-v2`: passed using the unchanged previous worktree's
  audit implementation as a read-only tool with this checkout as `--root`.
  Baseline: 16,209 keys; zero missing pairs, duplicate keys, or undefined static
  translation calls. All output and runtime data still used the designated root.
- `frozen-install`: passed. Pre-build workspace-bin warnings require build/link
  verification; they are not installed-runtime evidence.
- `post-merge-catalog-build` and `post-merge-i18n-check`: passed after 62 reviewed
  keys were assigned to stable project-access, gateway, onboarding, and error
  source owners. Generated catalogs are not edited directly.
- OpenCode/SDK targeted checks: 43 passed and both package typechecks passed.
  An initial Windows test failed while executing a Linux `BASH_ENV` hook with the
  host shell. Windows retains hook materialization/relocation assertions; actual
  shell execution stays in Linux coverage after the platform-scoped fixture fix.

Full new-head CI, installed acceptance, merge, channel promotion, and stable
publication remain incomplete until their own evidence is recorded.
