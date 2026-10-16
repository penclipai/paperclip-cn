# Final audit localization and external adapter contract acceptance

## Scope

Finish the remaining application-owned audit/history and agent-chat picker copy, and repair the external adapter credential-test contract before freezing the next Windows QA candidate. Keep the upstream boundary at `fb21a3f30ac16f8dd281299f29b077285cb5f130`. Preserve raw event IDs, package/provider/tool identifiers, user names, document keys/titles, service names, and external errors.

The activity formatter must use existing semantic templates for dynamic text. Check every known action label and each structured branch: status/priority, assignment, review policy, blockers/reviewers/approvers, interactions, review verdicts, plan decomposition, tools, monitors, and documents. Add semantic pairs only where the catalog has no suitable entry. Resolve text at render time and keep the existing English and unknown-value fallbacks.

External credential tests must accept schema-declared external onboarding keys through the real shared-validator/server path. Preserve builtin validation, company access checks, secret handling, and a bounded external payload. Do not add brand-specific core behavior. Decide the smallest implementation from the existing registry and schema contracts, then verify accepted and rejected requests.

## Implementation and verification

1. Write regressions before applying each repair. Prove the old implementation fails, then generate runtime catalogs and prove the repaired behavior passes.
2. Use real English/Chinese resources for formatter and picker tests. Verify raw interpolated content survives unchanged and language changes affect application text.
3. Check the external credential test at the validator and server boundary, including a synthetic external key, builtin compatibility, invalid keys/payloads, and unavailable adapters.
4. Run catalog consistency, UI token gates, focused tests, typecheck, and independent source review. Generate a fresh i18n audit; distinguish dynamic-call warnings from missing translations.
5. Freeze the complete source commit before packaging. Run the supported full test matrix with coverage reconciliation: general server shards, serialized shards, and all workspace projects. Record actual terminal results and defined skips.
6. Build the real Windows package with the existing 8 GiB capacity gate. Temporary profiles, build caches, and evidence use D:. Preserve SDK/workspace link identities before and after packaging. Run the full production build and repository typecheck, then seal the installer and product tree to the actual build SHA.
7. Verify final installed core behavior and real Grok task/artifact/log/cancellation/pause/recovery flows. Complete fresh install, data-preserving uninstall, TEMP/TMP boundaries, all-users installation, normal-user launch, and UAC evidence. An already-elevated harness does not prove stock NSIS internal elevation.

## Existing evidence and remaining gates

`68a1c564c2e7a0d5f39b1fd0c781b79eb4370290` passed the full Windows and production builds, typecheck, SDK/link preservation, an 82,056-file installed-tree comparison, core/preferences/restart/normal-exit checks, and a successful data-preserving current-user uninstall. Its unsigned QA installer remains retained with SHA-256 `3476e62cf08d9f295ee4995e9e8d6cb35e935ed783ad961f1ff57e407c4fc70e`. These results do not establish acceptance of subsequent source changes.

`c7891339b3fa7f6ebf8d59ad704d9194eb816c0d` added the initial unread/queued-comment repair. Its focused 18-test suite, catalog check, UI typecheck, token gates, and independent review passed. Its workspace lane passed 8,272 UI tests and 529 CLI tests, with three defined UI skips. All 57 GitHub checks completed without failure on that head; these results do not substitute for the next source head.

The final formatter/picker patch passed 33 focused tests with real bilingual resources, UI typecheck, catalog consistency, token gates, and independent review. Its 73 new semantic pairs bring both catalogs to 16,090 keys. The fresh audit and baseline comparison found no removed definitions, missing translations, duplicate keys, undefined static calls, or new suspicious Chinese fallbacks. The 259 dynamic-call warnings remain review leads. Both complete audit reports are retained as byte-verified gzip archives under the canonical checkout's `.omx/i18n-key-audit/`.

The external credential repair passed 142 focused validator/route/HTTP-log tests and shared/server typecheck. Its final additional provider compatibility assertion passed with all 49 route tests. Independent review approved bounded raw-key validation, active-schema authorization, inherited/accessor/malformed metadata rejection, transient generic credential projection, legacy compatibility, submitted-secret redaction, and case-insensitive sensitive-route classification. Full final-head validation and a new QA package remain required.

Keep PR checks and review feedback tied to the current source SHA. Greptile 5/5 remains a merge gate until fulfilled or explicitly resolved under the repository workflow. Formal version selection, signing provider/credentials, and stable publication follow engineering acceptance. Formal distribution requires a fresh build from the selected final merge SHA/tag and verified signing.
