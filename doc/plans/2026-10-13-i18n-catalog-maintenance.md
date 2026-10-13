# Translation catalog maintenance

## Accepted outcome

Split editable translation data into domain files, generate the existing flat
English and zh-CN catalogs, require explicit review after English changes, and
improve upstream-sync auditing. Preserve every current key, translation, caller,
locale fallback, and runtime resource path. Do not migrate shared keys or add
runtime namespaces in this change.

## Behavior lock and implementation order

1. Capture the current two catalogs and their canonical hashes before edits.
   Add fixture tests for generation, review state, duplicate keys, formatting,
   invalid data, missing translations, and read-only artifact checks first.
2. Introduce `ui/locales-src` paired-language entries. Semantic-shaped keys use
   their first prefix in a `domain-<lowercase-prefix>.json` file. Other keys use
   the first ASCII letter in `source-text/a-z.json`, or `other.json`.
   Each entry contains `en`, `zh-CN`, and `reviewedEnglishHash`.
3. Migrate all 15,059 entries mechanically, initialize the current reviewed
   baseline, generate sorted UTF-8/LF resources, and prove complete mapping
   equality with the captured baseline before proceeding.
4. Connect read-only checks to existing development, test, build, UI-copy, and
   desktop-staging paths. Reused UI artifacts must match generated catalogs.
   Tests and checks never repair generated files automatically.
5. Extend the existing snapshot audit with binding-aware translation-call
   classification, missing static keys, separate resource scopes, and explicit
   legacy findings. New/regressed undefined keys fail; ambiguous or dynamic
   calls remain inspectable leads. Unused keys are never deletion authority.
6. Update the maintenance policy and development instructions; run focused
   tests, review the final diff, then run required broad verification.

## Review and compatibility contracts

- `i18n:build` validates and generates the two existing resource files.
- `check:i18n` is read-only and rejects stale resources or unreviewed English.
- `i18n:review -- --key <key>` updates only explicitly selected review hashes.
- SHA-256 uses the exact English string bytes, without normalization.
- Sorting uses ordinal string comparison, never host locale collation.
- Duplicate definitions or implicit overrides fail. Each entry has one owner.
- Preserve the exact monthly-date formatting exception:
  `scheduleDescription.dayOfMonthOrdinal` uses `ordinal` in English and `count`
  in zh-CN. The caller supplies both. Other placeholder sets must match.
- Keep the upstream three-message/40-locale implementation and its tests; do
  not confuse it with the production common catalog or reinitialize runtime.
- Current production fallback remains a grounded compatibility boundary and
  is not replaced or broadened. Existing audit findings are captured rather
  than concealed; only new/regressed findings become additional blockers.

## Acceptance and evidence

Prove all existing mappings unchanged, repeated generation idempotent, check
mode non-mutating, stale artifact rejection, English review invalidation,
translation aliases and shadowing, missing static calls, dynamic-prefix leads,
and the `tar.t` negative case. Verify current locale/server tests, merge harness,
typecheck, tests, build, and Windows package resources. Record natural skips and
independent environment failures explicitly. The existing PR's npm bootstrap
blocker, package publication, merging, and release are outside this change.
