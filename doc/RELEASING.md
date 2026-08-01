# Releasing Paperclip

Maintainer runbook for shipping Paperclip across npm, GitHub, and the website-facing changelog surface.

The release model is now commit-driven:

1. Every push to `master` publishes a canary automatically.
2. Stable releases are manually promoted from a chosen tested commit or canary tag.
3. Stable release notes live in `releases/vYYYY.MDD.P.md`.
4. Only stable releases get GitHub Releases.

## Versioning Model

Paperclip uses calendar versions that still fit semver syntax:

- stable: `YYYY.MDD.P`
- canary: `YYYY.MDD.P-canary.N`

Examples:

- first stable on March 18, 2026: `2026.318.0`
- second stable on March 18, 2026: `2026.318.1`
- fourth canary for the `2026.318.1` line: `2026.318.1-canary.3`

Important constraints:

- the middle numeric slot is `MDD`, where `M` is the UTC month and `DD` is the zero-padded UTC day
- use `2026.303.0` for March 3, not `2026.33.0`
- do not use leading zeroes such as `2026.0318.0`
- do not use four numeric segments such as `2026.3.18.1`
- the semver-safe canary form is `2026.318.0-canary.1`

## Release Surfaces

Every stable release has four separate surfaces:

1. **Verification** — the exact git SHA passes typecheck, tests, and build
2. **npm** — `penclip` and public workspace packages are published
3. **GitHub** — the stable release gets a git tag and GitHub Release
4. **Website / announcements** — the stable changelog is published externally and announced

A stable release is done only when all four surfaces are handled.

Canaries cover verification, npm publish, automated Docker + Playwright smoke, plus an internal traceability tag.

## Core Invariants

- canaries publish from `master`
- stables publish from an explicitly chosen source ref
- tags point at the original source commit, not a generated release commit
- stable notes are always `releases/vYYYY.MDD.P.md`
- canaries never create GitHub Releases
- canaries never require changelog generation

## TL;DR

### Canary

Every push to `master` runs the canary path inside [`.github/workflows/release.yml`](../.github/workflows/release.yml).

It:

- verifies the pushed commit
- computes the canary version for the current UTC date
- publishes workspace packages dependency-first under npm dist-tag `canary`
- waits for each package version to become registry-visible before continuing
- publishes the user-facing `paperclipai` package last, so `paperclipai@canary` does not advance before the full package set exists
- verifies that `canary` resolves to the just-published version and that published internal dependencies exist on npm
- installs `paperclipai@canary` into a clean temporary prefix as the final npm gate
- fails by default if npm leaves `latest` pointing at a canary; use `--allow-canary-latest` only when that state is intentional
- creates a git tag `canary/vYYYY.MDD.P-canary.N`
- calls [`.github/workflows/release-smoke.yml`](../.github/workflows/release-smoke.yml) against the published `canary` dist-tag

Users install canaries with:

```bash
npx penclip@canary onboard
# or
npx penclip@canary onboard --data-dir "$(mktemp -d /tmp/paperclip-canary.XXXXXX)"
```

### Stable

Use [`.github/workflows/release.yml`](../.github/workflows/release.yml) from the Actions tab with the manual `workflow_dispatch` inputs.

[Run the action here](https://github.com/penclipai/paperclip-cn/actions/workflows/release.yml)

Inputs:

- `source_ref`
  - commit SHA, branch, or tag
- `stable_date`
  - optional UTC date override in `YYYY-MM-DD`
  - enter a date like `2026-03-18`, not a version like `2026.318.0`
- `dry_run`
  - preview only when true

Before running stable:

1. pick the canary commit or tag you trust
2. resolve the target stable version with `./scripts/release.sh stable --date "$(date +%F)" --print-version`
3. create or update `releases/vYYYY.MDD.P.md` on that source ref
4. dispatch the stable workflow with `dry_run=true` and wait for `verify_stable` / preview jobs to succeed
5. dispatch the same stable workflow input with `dry_run=false`
6. verify the published surfaces directly after the live workflow completes

Example:

- `source_ref`: `master`
- `stable_date`: `2026-03-18`
- resulting stable version: `2026.318.0`

The workflow:

- re-verifies the exact source ref
- computes the next stable patch slot for the chosen UTC date
- publishes `YYYY.MDD.P` under npm dist-tag `latest`
- creates git tag `vYYYY.MDD.P`
- creates or updates the GitHub Release from `releases/vYYYY.MDD.P.md`
- builds unsigned Electron desktop assets for Windows, macOS, and Linux with the same stable version injected into `electron-builder`
- uploads those desktop assets to the same GitHub Release as downloadable artifacts
- runs the reusable release smoke workflow against the published `latest` dist-tag

### Post-Release Verification

After a live stable release completes, verify the published surfaces directly:

```bash
npm view penclip@latest version dependencies dist-tags --json
npm view <release-enabled-package>@latest version dependencies dist-tags --json
gh release view vYYYY.MDD.P --repo penclipai/paperclip-cn --json tagName,name,isDraft,isPrerelease,publishedAt,url,assets
git ls-remote --tags <paperclip-cn-remote> vYYYY.MDD.P
gh run view <release-run-id> --repo penclipai/paperclip-cn --json status,conclusion,headSha,url,jobs
```

For stable releases, the GitHub Release assets should include the supported desktop installer set listed below. Do not use this checklist to record one-off version numbers or run ids.

On Windows PowerShell, prefer inline environment variables inside bash when invoking release helpers:

```powershell
bash -c 'RELEASE_REMOTE=<paperclip-cn-remote> ./scripts/release.sh stable --date YYYY-MM-DD --print-version'
```

Do not assume `$env:RELEASE_REMOTE = "..."` has reached a nested bash process unless the command output proves it used the intended remote.

### Desktop Installer Assets

Stable releases now also publish desktop installers through [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml).

Current contract:

- Windows x64
- macOS x64
- macOS arm64
- Linux x64
- unsigned desktop artifacts first
- stable live releases only
- attached to the existing GitHub Release `vYYYY.MDD.P`
- canaries do not publish desktop assets

The desktop packaging workflow injects the stable version through `PAPERCLIP_DESKTOP_RELEASE_VERSION` so the installer file names follow the real release version instead of the package placeholder `0.0.1`.

Notes:

- macOS publishes separate x64 and arm64 builds in this phase
- this phase does not attempt a universal macOS app
- notarization/signing remains a follow-up task

You can also run the workflow manually from GitHub Actions when you need a standalone packaging rerun:

- `source_ref`: commit, branch, or tag to package
- `release_version`: the desktop version to inject, for example `2026.413.0`
- `artifact_name`: Actions artifact name
- `upload_to_release`: whether to attach installers to an existing GitHub Release
- `github_release_tag`: required when uploading, for example `v2026.413.0`

## Local Commands

### Preview a canary locally

```bash
RELEASE_REMOTE=<paperclip-cn-remote> ./scripts/release.sh canary --dry-run
```

### Preview a stable locally

```bash
RELEASE_REMOTE=<paperclip-cn-remote> ./scripts/release.sh stable --dry-run
```

From PowerShell, use the inline bash form shown in Post-Release Verification when you need to guarantee the variable is visible to the shell script.

### Publish a stable locally

This is mainly for emergency/manual use. The normal path is the GitHub workflow.

```bash
RELEASE_REMOTE=<paperclip-cn-remote> ./scripts/release.sh stable
git push <paperclip-cn-remote> refs/tags/vYYYY.MDD.P
PUBLISH_REMOTE=<paperclip-cn-remote> ./scripts/create-github-release.sh YYYY.MDD.P
```

## Stable Changelog Workflow

Stable changelog files live at:

- `releases/vYYYY.MDD.P.md`

Canaries do not get changelog files.

Recommended local generation flow:

```bash
VERSION="$(./scripts/release.sh stable --date 2026-03-18 --print-version)"
claude --print --output-format stream-json --verbose --dangerously-skip-permissions --model claude-opus-4-6 "Use the release-changelog skill to draft or update releases/v${VERSION}.md for Paperclip. Read doc/RELEASING.md and .agents/skills/release-changelog/SKILL.md, then generate the stable changelog for v${VERSION} from commits since the last stable tag. Do not create a canary changelog."
```

The repo intentionally does not run this through GitHub Actions because:

- canaries are too frequent
- stable notes are the only public narrative surface that needs LLM help
- maintainer LLM tokens should not live in Actions

## Smoke Testing

For a canary:

```bash
PAPERCLIPAI_VERSION=canary ./scripts/docker-onboard-smoke.sh
```

For the current stable:

```bash
PAPERCLIPAI_VERSION=latest ./scripts/docker-onboard-smoke.sh
```

Useful isolated variants:

```bash
HOST_PORT=3232 DATA_DIR=./data/release-smoke-canary PAPERCLIPAI_VERSION=canary ./scripts/docker-onboard-smoke.sh
HOST_PORT=3233 DATA_DIR=./data/release-smoke-stable PAPERCLIPAI_VERSION=latest ./scripts/docker-onboard-smoke.sh
```

Automated browser smoke is also available:

```bash
gh workflow run release-smoke.yml -f paperclip_version=canary
gh workflow run release-smoke.yml -f paperclip_version=latest
```

The main release workflow now calls that reusable smoke workflow automatically after both canary and stable publishes. Trigger `release-smoke.yml` manually when you want an isolated rerun without republishing.

On Windows, a lightweight local smoke can cover the npm install path and embedded PostgreSQL first boot without Docker:

```powershell
$dir = Join-Path $env:TEMP ("paperclip-smoke-" + [guid]::NewGuid())
$env:PORT = "3233"
$env:PAPERCLIP_OPEN_ON_LISTEN = "false"
npx --yes penclip@latest onboard --yes --bind loopback --data-dir $dir
# In another terminal, check:
Invoke-RestMethod http://127.0.0.1:3233/api/health
```

Stop the foreground server after the health response reports the expected version.

Minimum checks:

- `npx penclip@canary onboard` installs
- onboarding completes without crashes
- authenticated login works with the smoke credentials
- the browser lands in onboarding on a fresh instance
- company creation succeeds
- the first CEO agent is created
- the first CEO heartbeat run is triggered

## Rollback

Rollback does not unpublish versions.

It only moves the `latest` dist-tag back to a previous stable:

```bash
./scripts/rollback-latest.sh 2026.318.0 --dry-run
./scripts/rollback-latest.sh 2026.318.0
```

Then fix forward with a new stable patch slot or release date.

## Failure Playbooks

### If the canary publishes but smoke testing fails

Do not run stable.

Instead:

1. fix the issue on `master`
2. merge the fix
3. wait for the next automatic canary
4. rerun smoke testing

### If stable npm publish succeeds but tag push or GitHub release creation fails

This is a partial release. npm is already live.

Do this immediately:

1. push the missing tag
2. rerun `PUBLISH_REMOTE=public-gh ./scripts/create-github-release.sh YYYY.MDD.P`
3. verify the GitHub Release notes point at `releases/vYYYY.MDD.P.md`

Do not republish the same version.

### If `latest` is broken after stable publish

Roll back the dist-tag:

```bash
./scripts/rollback-latest.sh YYYY.MDD.P
```

Then fix forward with a new stable release.

## Related Files

- [`scripts/release.sh`](../scripts/release.sh)
- [`scripts/release-package-map.mjs`](../scripts/release-package-map.mjs)
- [`scripts/create-github-release.sh`](../scripts/create-github-release.sh)
- [`scripts/rollback-latest.sh`](../scripts/rollback-latest.sh)
- [`.github/workflows/desktop-release.yml`](../.github/workflows/desktop-release.yml)
- [`doc/PUBLISHING.md`](PUBLISHING.md)
- [`doc/RELEASE-AUTOMATION-SETUP.md`](RELEASE-AUTOMATION-SETUP.md)
