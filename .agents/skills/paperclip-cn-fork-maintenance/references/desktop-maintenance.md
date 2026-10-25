# Desktop Maintenance And Release Evidence

Use this reference when a sync touches desktop deployment, installer behavior,
native payloads, or release assets, or when the user requests installed-app
acceptance. Exact entrypoints and implementation limits belong in
[DEVELOPING.md](../../../../doc/DEVELOPING.md); stable publication policy belongs
in [RELEASING.md](../../../../doc/RELEASING.md).

## Select Evidence By Scope

| Change or request | Evidence needed |
|---|---|
| Ordinary sync without desktop changes | Existing merge/compatibility gates and relevant diff review; no automatic full installer campaign |
| Deployment staging or dependency linking | Staging regression checks, package build, source dependency integrity before/after, packaged runtime probe |
| NSIS hooks or installer extraction | Maintained NSIS regression probe, full-payload installation comparison, affected install/upgrade/uninstall and TEMP/TMP cases |
| Per-user/all-users behavior or UAC | Separate results for each affected mode and actual elevated environment; per-user success cannot prove all-users behavior |
| Native payload trimming, linking, or archive changes | Payload fixtures, native unpacked-app and final-container probes, installer and runtime size audits |
| Installed product/agent flow change or explicit full acceptance | Installed-app core checks plus a real authorized agent journey through the affected flow |
| Public installer publication or replacement | Complete supported-platform build set, manifests and hashes, then actual public-download verification |

Record the source SHA, target, build/run identity, installed executable/version,
and the evidence level passed. Mock, `--version`, build, and installer-hook
checks do not prove the same behavior as a real installed-app journey. Keep
unreachable/manual cases explicit; skipped cases are not passes.

## Protect The Source Workspace

Packaging's production deployment runs inside the staged workspace copy.
Preserve its manifest, lifecycle-script, patch, and workspace-reference inputs.
Do not run hoisted deployment against the live checkout: it can replace AI SDK
dependency junctions with incomplete directories. A different linker setting
does not prove isolation and can change archive expansion/path lengths.

Compare relevant junction targets and import resolution before and after
packaging, as well as probing the packaged runtime. Repair the staging boundary
when packaging causes damage; repeated manual dependency restoration is not a
completed fix. Do not rewrite the lockfile or force reinstall as a substitute
for diagnosing the side effect.

## Windows Installation And Temporary Data

Use a task-owned test instance, installation directory, and evidence directory.
Honor the user's chosen temporary-data drive throughout staging, child
processes, elevation, extraction, and cleanup. Budget peak space for old backups,
downloaded artifacts, unpacked runtime, and new packages before a large build.
Clean verified task-owned duplicates only after retaining the required evidence
and rollback files; do not move temporary data to another drive to evade a limit.

Follow the current NSIS hook contract in `DEVELOPING.md`:

- Preserve independent TEMP/TMP values and their missing/empty semantics; test
  short, long, and rejected-boundary cases using the maintained probe.
- An ordinary UAC handoff may not inherit the caller's temporary environment.
  When same-drive containment is required, use the documented elevated-shell
  route with explicit TEMP/TMP and verify the elevated values.
- A launched helper is not proof that a UAC prompt appeared or was accepted.
  Track the owned process, result, and timeout before retrying. Let the user
  complete secure-desktop confirmation; do not leave overlapping requests.
- Keep full-payload, current-user/all-users, upgrade, uninstall/data-retention,
  and reinstall results distinct. The small NSIS CI probe cannot replace them.
- Compare installed runtime files with the unpacked build before app acceptance.
  Installer exit code zero alone does not prove complete extraction.
- Verify retention separately for desktop user data and CLI/server instance
  data. Use isolated sentinels or supported read-only checks; do not migrate,
  reset, or clean a live database as an acceptance shortcut.

Do not replace the maintained archive format solely to work around path length;
large archives can exceed an extractor's format/entry-count support. Recheck the
current extractor contract before proposing an alternative.

For real agent acceptance, use an already authorized CLI/provider and bounded
test task: create/configure an agent, execute, inspect its artifact and run log,
then exercise the applicable stop/resume flow. Record task/run/artifact evidence
and cleanup; keep credential stores and raw sensitive logs out of reports.
Grok CLI is one possible authorized provider, not a required core dependency.

## Payload Size And Native Compatibility

Compare the same platform/architecture and measure both compressed installer
bytes and unpacked runtime bytes. Inspect the dependency inventory before
changing compression or removing files; a larger package is not itself proof of
a regression. Use the reviewed size budget and explain any baseline update.

For the current OpenCode optimization, preserve these boundaries:

- Trim only the staged runtime, using the actual vendored Runner resolver's
  qualified version/platform/architecture/libc selection.
- Keep conservative CPU compatibility where selected; do not replace baseline
  binaries with faster variants just because the CI host can execute them.
- Replace the portable entrypoint with a relative symlink only after byte
  equality with the selected native executable is proven. Preserve a differing
  regular portable executable and verify both entrypoints.
- Preserve Windows and other providers unless separately qualified. Unknown
  versions, layouts, libc, or unsafe paths stop optimization pending review.
- Probe the unpacked app and the final read-only DMG or extracted AppImage on
  the native platform. Keep probe lifetimes bounded so library handles close
  before unmount; cleanup may affect only the verifier's own temporary mount.

Reuse the package's `test:payload`, runtime probe, and `audit:size:check` paths
from the current desktop workflow. A local directory audit does not prove final
archive semantics. Do not raise budgets simply to turn a red build green.

## Repairing Existing Release Installers

Choose this path only for a requested installer repair of an existing stable
Release. If application code or runtime dependencies change, return to the
normal release/candidate policy rather than silently replacing stable bits.

1. Reconcile the existing Release, stable tag/source SHA, version, notes,
   package dist-tags, and asset inventory. For a different packaging source SHA,
   inspect its diff from the stable source and prove the application/runtime
   and lockfile inputs remain unchanged; record the packaging-only provenance.
2. Retain old installer files and checksums with verified hashes. Record asset
   IDs, names, sizes, hashes, and Release metadata; preserve non-target assets
   such as the feature catalog. GitHub replacement is not atomic.
3. Build through the maintained desktop workflow with a pinned source and the
   original `release_version`. Record workflow revision separately from build
   source, run/attempt, and artifact IDs. A renamed diagnostic or size-test file
   does not acquire the formal embedded version or release qualification.
4. Require all supported targets from the intended build set to finish their
   build, native probes, and size gates. Single-target retries can diagnose a
   failure; do not treat a partial matrix or retained failure artifact as a
   publishable set. Require `target=all`; resolve the expected platform set from
   the current workflow and asset-preparation helper instead of a remembered list.
5. Use `.github/scripts/prepare-desktop-release-assets.mjs` to validate each
   target/version/exact filename, file containment, and nonempty payload, then
   recompute hashes and generate `SHA256SUMS.txt`. Keep public writes in the
   aggregate upload step after the matrix; never publish from individual legs.
   Verify internal product versions as well as names/manifests where available.
6. Before replacement, re-read the Release and compare against the snapshot. An
   unexpected asset, tag, or metadata change requires reconciliation. Replace
   only the authorized installers and checksum. Preserve stable tag, npm state,
   original notes/warnings, and unrelated assets; a concise packaging-provenance
   addition may document the repair without rewriting the release notes.
7. Re-read metadata and stream the public download URLs to verify each expected
   asset's size and SHA-256, including the checksum and preserved attachments.
   Upload success and API digest fields alone are not download evidence. Keep
   old backups until verification succeeds, then remove only owned duplicates.

For interrupted replacement, compare each live asset with the recorded old/new
hashes and finish or restore only the known set. Report mixed or unknown state
precisely; do not delete the Release, move its tag, or republish npm to recover.
If release immutability prevents repair, use the repository's supported new
release path instead of bypassing the protection.

Signing is a separate distribution decision. Record the release's actual
signature status and required user-facing warnings. An approved unsigned release
or a waived review score does not create a standing exemption for future releases.
