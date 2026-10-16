# 2026-10-16 Windows acceptance follow-ups

Goal: close the concrete Windows test and localization findings without weakening ownership, stop, redaction, or install-isolation checks.

Work occurs in the isolated D: worktree at source 8d107b306f60dc776b01ca7c878f25614f6775ba. The active installed-app acceptance, main checkout, frozen unit-resume worktree, original database, and prior receipts remain untouched.

1. Add a failing regression for a prewarmed default log-redaction candidate set followed by a HOME/USERPROFILE change. Remove only the stale default-candidate cache (or invalidate it by actual relevant environment inputs), preserving explicit options and full-home masking. Run existing redaction and run-failure-report tests.
2. Reproduce and safely classify the local Git missing-ref output. Keep exit 128, empty stdout, and exact requested ref as mandatory evidence; match only equivalent anchored diagnostic forms. Add positive and negative cases before the minimal diagnostic change.
3. Add bounded deadlines to Windows port-owner and process-ancestry external queries using existing timeout conventions. Timeout means ownership is unproven; it must not authorize killing or adopting a process. Cover the timeout/error branch and the foreign HTTPS listener regression without raising its test timeout.
4. Correct the Error.message assertion independently of enumerable properties. Diagnose the pnpm 9/12 mismatch with the exact child invocation. Prefer a properly pinned QA invocation; change the provision script only if a real supported invocation defect is reproduced and covered. Do not weaken version or workspace guarantees.
5. Localize application-owned audit entity-type fallbacks with the existing label helper in both feed implementations. Add the user-preference semantic key and reviewed hash; regenerate catalogs. Keep event IDs, entity IDs, package/plugin names, and user-authored content raw. Add focused bilingual rendering tests and run locale/token gates.
6. The fresh Windows checkout exposed CRLF-only drift in the generated palette and character token files. Confirm LF-normalized equality, then pin only these two generated paths to LF in `.gitattributes`. Verify Git's checkout filters with `core.autocrlf=true` and rerun token gates; do not change their semantic contents.

No new dependencies. File ownership is assigned per lane; shared workspace-runtime test edits remain with one owner. All test homes, temp, caches, logs, and new evidence remain on D:. Tests run sequentially when stateful; do not launch duplicate long suites. Failed roots and earlier evidence are retained.

Review the plan separately before implementation. Each lane adds regression evidence first, makes the smallest fix, and reports its exact changed files and validation gaps. Review the combined patch independently, then integrate only after the active lifecycle stability window ends. Rebuild the final product candidate for product-source changes; preserve the distinct 400e installation and Grok evidence rather than relabeling it as the new build. Finish with appropriate targeted tests, typecheck/build, current-head CI, and final installed smoke.
