# Desktop runtime size optimization

The published v2026.1021.0 installers grew by 56–76% compared with v2026.716.0.
Archive inspection found multiple OpenCode native variants, identical portable
and native OpenCode binaries, and large CLI/SDK dependencies. Preserve the
offline desktop runtime and existing provider entrypoints while removing only
payloads proved unnecessary for the supported desktop targets.

## Implementation and verification order

1. Add fixture regression coverage before changing staging. Cover macOS arm64,
   macOS x64, Linux x64 and Windows x64; preserve baseline CPU support, the
   portable OpenCode entrypoint, database binaries, provider dependencies and
   files outside the staging directory. Do not prune libc variants speculatively.
2. Add a desktop-only staging pass which retains the native package selected by
   the existing Runner resolver. Reuse a single OpenCode binary through a
   relocatable link on Unix where packaging preserves links. Keep Windows
   behavior unless an equivalent safe reduction is demonstrated.
3. Make the existing desktop size audit enforce reviewed per-platform limits
   and report native variants and duplicate payloads. Run the audit in desktop
   CI and retain JSON/Markdown evidence even when a budget fails.
4. Run targeted staging, provider selection and size-budget tests. Build and
   smoke the Windows runtime locally with temporary paths on D:. Use the native
   macOS/Linux CI matrix to verify the resulting archives and provider commands;
   compare measured installer and unpacked runtime sizes with v2026.1021.0.
5. Review the final diff and document measured savings and validation gaps.
   Keep the published v2026.1021.0 assets unchanged; a new release is separate.

No new dependencies, database migrations, UI changes, or external-adapter
registrations are part of this optimization.
