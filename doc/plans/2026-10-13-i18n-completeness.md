# Production UI localization completeness

## Approved outcome

Work on `codex/upstream-sync-20261012`. Fix application-owned untranslated text
across reachable production routes, detail pages, settings, menus, dialogs, and
error/empty/loading states. Use an isolated local instance with representative
fixtures and the built-in browser. Preserve user content, provider/model names,
technical identifiers, persisted values, and existing product behavior.

## Baseline and implementation order

1. Preserve the current catalog maps, v2 key audit, commit, and source-text
   candidate inventory. The starting audit has 18 actual missing static calls;
   the initial JSX pass has 437 English candidates in 115 non-lab files, which
   are classification leads rather than a defect count.
2. Lock confirmed regressions with targeted catalog/runtime/component coverage.
   Fix missing calls and decision-count plural suffixes first, reusing existing
   semantic keys where possible. Keep the legacy dotted plural keys.
3. Scan raw JSX, visible attributes, string branches, templates, and label
   configurations. Review dynamic calls and same-English catalog entries by
   ownership. Translate in domain lanes without rewriting whole components.
4. Only edit paired authoring sources under `ui/locales-src`; one integrator
   owns shared catalog files, reviews explicit English changes, and generates
   the existing flat resources. No runtime namespace migration or new dependency.
5. Maintain locale subscriptions and interpolation; do not freeze translated
   labels at module initialization. Preserve open dialogs and edited drafts
   when switching languages. Use existing tokens if text fitting needs changes.
6. Derive production coverage from App routes and feature gates. Use isolated,
   non-running agents/fixtures. Mock third-party authorization and external
   actions rather than sending real requests. Inspect before/after interactions,
   and record data-dependent/unreachable surfaces explicitly.
7. Add reusable candidate scanning, focused browser regressions, and maintenance
   instructions. Keep transient reports and screenshots in
   `.omx/i18n-browser-audit/`.

## Acceptance

- Missing positively classified static calls become zero; locale parity,
  duplicate definitions, review hashes, and placeholders remain valid.
- Confirmed application-owned untranslated candidates are fixed. Remaining
  technical/user content and unreachable surfaces have explicit classifications.
- Exercise decision counts 0/1/2, dynamic names, error/loading/empty states,
  language switching with preserved drafts, and desktop/narrow-screen fit.
- Run catalog/audit tests, localization/component tests, token gates, merge
  harness, typecheck, full tests, build, and fresh copied/staged/packaged catalog
  checks. Record actual exits. The previous five failures in three unchanged
  server test files are retained as baseline debt; new failures must be fixed.
- Commit locally on the selected branch. Publication, master merge, and release
  are not part of this request.

## Implementation and verification record (2026-10-14)

- Implementation commit: `b2bda957b88543f8c6a14dee8958aec07b3696e9`.
  The production catalog grew from 15,059 to 15,589 paired keys (+530). Existing
  English and Chinese mappings are preserved; the dotted decision plural keys
  remain while current callers use i18next-compatible underscore variants.
- Filled source and rendered findings in connections/apps, profile setup,
  skills/import/studio, adapter configuration, approval/decision/audit/cost
  views, workspace/task/composer/status controls and generated labels. Shared
  translated metadata now follows the active locale without changing entity
  IDs, action ordering, API values, editable drafts or user-authored names.
- Added `audit:i18n-visible` and its fixtures plus `test:e2e:i18n`. Source
  inventories remain review leads: the final broad scanner has 3,755 visible
  candidates and 5,248 uncertain branches, and the key audit has 195 dynamic
  leads. These counts include technical data and translated-at-consumer labels;
  they are not outstanding-defect counts or a zero-English gate.
- The final binding-aware key snapshot reports 0 undefined static calls,
  0 missing locale definitions and 0 duplicate keys. Catalog/scanner/artifact
  tool tests passed (30 tests). Token gates, module boundaries, upstream merge
  harness, repo typecheck and build passed. UI typecheck was rerun after repairs.
- Full UI suite: 737 files passed, 1 skipped; 8,236 tests passed, 3 skipped.
  Its initial run exposed accessibility/mock/plural regressions; those were
  repaired before the passing run. Focused tests additionally exercise locale
  switching, no-assignee placeholders, raw names and filter/group identities.
- Full `pnpm test:run`: 71 files passed / 3 failed; 1,246 tests passed / 5 failed /
  4 skipped. The same five pre-existing failures remain in
  `agent-commentary-skills`, `agent-directory-working-copies` and
  `agent-instruction-working-copies`. Do not describe this repository gate as
  green; no unrelated server fix was bundled into the localization change.
- Browser evidence: 62 distinct literal board routes and 8 representative
  dynamic routes were opened. A profile-wizard cold load took longer than the
  first 3-second probe; a 20-second retry proved it rendered. Real account-menu
  language switching preserved an unsaved search draft (standard isolated E2E
  2/2). Final residual rechecks confirmed Chinese decision verbs, timeline and
  filters, plus the translated issue-status aria label and verbatim issue title.
  At 390px the document had no horizontal overflow; composer width was 340px.
- Residual coverage: valid external sign-in/grants, live agent execution,
  external plugin/provider data, and global invite/claim/auth flows requiring
  valid external accounts or tokens were not exercised. Third-party manifest
  descriptions, provider names, event IDs, paths and fixture-authored content
  remain raw under the ownership policy. This is no claim that every possible
  provider-dependent dialog or error state was reached.
- Isolation record: an initial environment-propagation mistake briefly started
  the default instance at port 3100. Its verified owned process tree was stopped
  before fixture API writes. Startup-time changes to default-instance metadata
  were not independently audited. All subsequent fixtures/browser checks used
  the verified separate home/config/database at port 3198, with heartbeat and
  on-demand execution disabled; standard E2E used its disposable 3199 instance.
- Local receipts, route classifications, screenshots and raw audit snapshots
  are retained under `.omx/i18n-browser-audit/` and verification logs under
  `.omx/i18n-maintenance/verification/`. They are intentionally ignored by Git.
  Windows staged/packaged catalog hashes are recorded after directory packaging.
- Fresh Windows directory packaging passed for the implementation commit.
  Authoring output, UI dist, server UI copy, staged Electron runtime and final
  `win-unpacked` runtime all contain exactly the same 15,589-key catalogs
  (five trees checked byte-for-byte). Baseline preservation verified all 15,059
  original EN and zh-CN mappings unchanged. Provider-utils imports pass in source,
  stage and final package. Packaging recreated the known physical source dependency
  shadow; its inspected 5.0.56 directory was backed up and the same-version
  canonical junction restored, with no manifest/lockfile/version changes.
  The package contains 446 top-level package roots, 9 bundled skills and 15
  bundled plugins; directory packaging is verification, not a published release.

## Follow-up CI repair (2026-10-14)

The later request authorizes pushing the selected branch and repairing GitHub
checks. The localization commits were pushed to fork PR #164 at `a73bab344`.
The first fresh CI run exposed additional Linux and fixture contract failures.

- Align DB's embedded PostgreSQL manifest and lock importer with the existing
  patched `18.1.0-beta.16` used by the server and CLI. A real isolated npm install
  and frozen-lockfile install verified that version; no new dependency was added.
- Preserve null prototypes when constructing expected Codex TOML tables.
  Candidate validation keeps strict equality and preserves unrelated dates,
  arrays, comments and configuration. Startup tests passed 9/9.
- Include `fs-ops.mjs` in retained qualification staging, and invoke the Windows
  npm CLI through Node. Retained-package tests passed on Windows and Linux.
- Correct stale CN namespace assertions and platform-specific npm, CLI, sandbox
  and repository-root fixtures. Keep frozen logical skill hashes independent of
  checkout line endings while retaining raw byte materialization assertions.
- Give asynchronous GitHub mention admission the existing bounded 10-second
  transaction wait. Both exact lifecycle cases passed.
- Keep Windows historical stop events non-authoritative in working-copy tests.
  Explicit owner collection verifies durable save and cleanup after rejection.
- Close fixture SQLite before capturing durable provider-home evidence; WAL/SHM
  files removed by fixture checkpointing are not handed to reconciliation.
  Native-session whole-file verification passed 612 tests with 70 Windows skips;
  the Linux-only provider-home case requires Linux CI evidence.
- Pin legacy English E2E journeys in disposable browser storage. The language
  switcher runs an explicit Chinese journey and preserves the chosen language
  after reload. A Windows recovery fixture uses `agentArgv`. Relevant browser
  specs passed 10 tests; debug logging and fixed sleeps were removed.
- Fresh repo typecheck and build passed. The complete release-registry command's
  19 Node test files passed 185 tests on official Linux Node 24.18.1 in WSL.
  Its archive SHA-256 was verified against Node's published checksum list.
  Local evidence remains under `.omx/ci-repair-20261014/` and
  `.omx/i18n-maintenance/verification/`.

The npm bootstrap policy remains a separate registry-state blocker: nine
release-enabled names do not exist on npm. Preserve the mandatory gate. First
publication needs the maintainer flow in `doc/PUBLISHING.md`; this repair does
not publish packages or change release enrollment. Refresh all remote checks
against the pushed repair commit before reporting its final CI state.

At repair commit `0802fec630`, remote typecheck/release-registry, build, canary
dry-run, Runner verification, and the previously failing native cleanup cases
passed. A further repair pass addressed the remaining fixture contracts:

- Match exact current editor/status accessible names, disambiguate the header
  status control, and keep full English/Chinese placeholder matches. Dedicated
  ports verified board/NUX (12), planning fixtures (2), Slack (1), AgentMail (2)
  and the full signoff spec (5).
- Correct the newly added AgentMail key link's English article and review only
  that semantic entry. This key was absent from the 15,059-key baseline; no
  original baseline mapping changed. Catalog/tool tests and token gates passed.
- Load mocked document-route dependencies during suite setup. Two fresh runs
  passed all six requests without counting cold module transformation as request
  time or invoking real external-object persistence through a mock database.
- Use an ordinary live-service fixture port outside the canonical managed
  exposure range. An ephemeral port in that range correctly triggers reservation
  recovery instead of adoption; the fixture now bounds retries and emits
  readiness only after a non-reserved listener is live.
- Align the DB native-runtime test with the selected patched PostgreSQL version's
  C message locale and preserved child environment. The runtime test passed.

The earlier signoff log contained a best-effort continuation-summary deadlock.
Independent signoff runs instead reproduced the stale selector and then passed
after its correction. No server lock-order change was made on that evidence.
