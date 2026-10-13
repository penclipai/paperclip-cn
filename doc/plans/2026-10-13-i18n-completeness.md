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
