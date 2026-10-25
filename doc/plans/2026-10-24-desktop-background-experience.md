# Desktop background experience — 2026-10-24

## Approved scope

Implement the first four desktop improvements: close to tray and restore, explicit
quit protection and progress, window/work-route restoration, and important native
notifications. Keep the existing UI design and bilingual catalog. Autostart,
automatic updates, release publication, and server task cancellation policy are
outside this change.

## Ownership and contracts

- Electron owns tray availability, window visibility, trusted IPC, native
  notifications, preference persistence, and the existing graceful worker stop.
- Preload exposes fixed methods only. Public preferences contain user toggles and
  observed platform capabilities; window coordinates and route history stay private.
- React retains the existing company-scoped live-event permission projection,
  eligibility, age, cooldown, and deduplication. Desktop mode keeps that one socket
  while hidden. Web visibility behavior is unchanged. No additional API polling.
- Approval-created events have a separate viewer decision: task participation
  eligibility intentionally excludes approvals. Reuse the approval route's read
  SQL and board/pending checks in the existing WebSocket delivery path; do not
  infer approval access in React or weaken personal task filtering.
- Notifications pass only company, stable ID, kind, and an internal path. Native
  text uses fixed translated templates, never issue titles, errors, or agent output.
- `ui/locales-src/semantic/domain-desktop.json` owns native text. The desktop build
  extracts only `desktop.*` from the generated catalog into its runtime asset.
- Preferences use validated atomic merging so theme, window, and tray writes cannot
  overwrite one another. Saved routes exclude auth/pairing pages, queries, and hashes.

## Lifecycle

Close hides only when a usable tray exists and the preference is enabled. First
hide explains continuing background work and provider usage. All restore paths
show, restore, and focus the same window. Tray creation failure falls back to
explicit quitting instead of leaving an inaccessible background process.

Ready-state quitting always explains the effect of stopping the local service.
Only a fresh current-company run summary may be shown; unknown is not zero and
does not describe other companies. Cancel leaves work running. Confirmation saves
state, displays stopping progress, and reuses the existing single-flight worker
shutdown. OS session ending bypasses hiding and confirmation without vetoing it.
An OS session query can be cancelled by another application, so only committed
`session-end` latches terminal state and starts best-effort cleanup.

## Verification and completion

1. Preference corruption/atomic merge, safe paths, removed monitors, and narrow
   preload channel/subscription tests.
2. Main lifecycle tests: close/hide versus quit, restore, missing tray, quit
   cancel/confirm/repetition, startup shutdown, OS session events, sender/frame/
   origin validation, notification privacy/company/dedupe/rate/click behavior.
3. UI tests: desktop versus Web hidden events, existing toast eligibility and
   dedupe, safe notification payload, context cache freshness, setting failures.
4. Catalog/build asset checks, token gates, desktop and UI typechecks, builds, and
   a real isolated Windows Electron launch/close/restore/restart/quit exercise.
5. Independent review of the completed diff. Record unexecuted OS/platform cases;
   a unit test or unpacked Windows launch is not installed cross-platform proof.

All runtime profiles, databases, caches, and temporary evidence remain on D.
The original dirty checkout and existing user services/data are not test fixtures.

## Implementation evidence

Work is isolated on `codex/desktop-tray-experience-20261024`, based on
`59e578899deeb334bb6f40f87d4f0a559244a869` in the existing sync worktree.
Verification receipts and failed attempts are retained under the ignored
`.omx/sync-fork-20261023/runs/` directory.

- Desktop: 69 tests across 10 files and typecheck passed, including lifecycle,
  trusted IPC, preferences, notifications, and measured Windows bounds recovery
  (`desktop-window-state-regressions-3`, `desktop-window-state-typecheck-2`).
- UI: 150 targeted tests across seven files, typecheck, token gates, and build
  passed. This includes Web/desktop visibility, live-event eligibility, settings
  failures, safe notification payloads, and current-company run-cache freshness.
- Server: 38 tests passed, including actual embedded-database approval read
  permissions and WebSocket membership revocation/failure continuation
  (`desktop-approval-actual-boundaries`); server typecheck and build passed.
- Payload/catalog: 23 payload tests and the generated bilingual catalog check
  passed. Release-profile Electron main/preload build passed after the bounds fix
  (`desktop-final-release-build-v5`).

### Failures retained and resolved

The real launch initially exposed early Electron profile lookup before the
application override: all three smoke launchers now pass the native
`--user-data-dir` switch. Probe-only failures in tray callback arguments, losing
timeout cleanup, HMR port preflight, and explicit embedded-Postgres configuration
were fixed with their failed-run evidence retained.

Real attempt v10 then exposed a product issue at Windows 175% scaling: saved
`961×682` bounds reconstructed as `965×687`, although the preference file was
correct. An independent native-only probe reproduced the constructor conversion;
overlay and minimum-size updates did not cause it. Windows restoration now uses
at most four measured `setBounds` corrections, stopping on an exact or repeated
native result. Two native restart-equivalent windows recovered exactly to
`961×682` and stayed stable after 500 ms; constrained minimum sizes stop without
looping. The final release-profile lifecycle run also recovered exactly.

Attempt v11 confirmed the exact bounds recovery, then failed when Playwright's
renderer evaluation was destroyed by confirmed quit. The probe now accepts only
that expected teardown during confirmed quit and still requires a zero Electron
exit code, no signal, and real HTTP/Postgres/PID closure. A normal evaluation
error or process crash remains a failure.

Attempts v12/v13 passed their lifecycle checks, but build-hash reconciliation
showed that a test import had started the older smoke script's unguarded main
function and rebuilt the desktop shell in development mode. Smoke entrypoints
now execute only when invoked directly, and the dependency-free helper-import
regression covers both launchers. Those results are retained as development-shell
evidence. The final release-profile check must match build v5's main/preload
hashes; it is not inferred from v13's success.

### Final acceptance

`desktop-background-real-v14` passed on 2026-10-24 (Asia/Shanghai), with wrapper
exit code 0. Its D-only evidence is
`D:/pc-sync-qa/desktop-background-20261024-v14/desktop-background-result.json`.
All nine functional assertions passed; the additional expected renderer-teardown
marker was recorded during confirmed quit. Both Electron instances exited with
code 0 and no signal, and both owned Postgres PIDs and their service ports closed.
The restored rectangle exactly matched the persisted `37,23,961,682` at 175% DPI.
The read-only residue check found no remaining matching smoke processes.

The artifact hashes match the frozen release-profile build v5:

- main: `9ca4cdcd87a7ba6a5f2fd53a0bb060b63a1c82c326bd4311e02f05be9b54bf66`
- preload: `b7cadb87cd1cee4d22c1ddba617496cd0cf6901cb8a28bb6b930fc1d48d39503`

The two launcher environment/import Node regressions passed after the harness
fixes. Independent native/UI/server review and the corrective harness review
finished with no remaining P1/P2 findings. Drive policy remains explicit for
portable CI: this run used the D-only environment plus `--required-drive D:`;
`DEVELOPING.md` contains the guarded Windows command.

### Evidence limits

This check uses the release-profile Electron shell with a development worker and
source UI. It does not constitute new NSIS installed-app acceptance. Physical
tray gestures, OS notification delivery, actual OS logoff, and macOS/Linux runtime
journeys are unexecuted. Targeted checks cover all changed runtime owners; the
entire monorepo check suite has not been repeated for this feature. No public
installer, release, remote branch, or existing user database is modified.
