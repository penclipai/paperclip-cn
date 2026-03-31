#!/usr/bin/env bash

if [ -z "${REPO_ROOT:-}" ]; then
  REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

release_info() {
  echo "$@"
}

release_warn() {
  echo "Warning: $*" >&2
}

release_fail() {
  echo "Error: $*" >&2
  exit 1
}

git_remote_exists() {
  git -C "$REPO_ROOT" remote get-url "$1" >/dev/null 2>&1
}

github_repo_from_remote() {
  local remote_url

  remote_url="$(git -C "$REPO_ROOT" remote get-url "$1" 2>/dev/null || true)"
  [ -n "$remote_url" ] || return 1

  remote_url="${remote_url%.git}"
  remote_url="${remote_url#ssh://}"

  node - "$remote_url" <<'NODE'
const remoteUrl = process.argv[2];

const patterns = [
  /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/,
  /^git@github\.com:([^/]+\/[^/]+)$/,
  /^[^:]+:([^/]+\/[^/]+)$/
];

for (const pattern of patterns) {
  const match = remoteUrl.match(pattern);
  if (!match) continue;
  process.stdout.write(match[1]);
  process.exit(0);
}

process.exit(1);
NODE
}

CANONICAL_RELEASE_GITHUB_REPO="${CANONICAL_RELEASE_GITHUB_REPO:-penclipai/paperclip-cn}"

remote_targets_github_repo() {
  local remote="$1"
  local expected_repo="$2"
  local actual_repo

  actual_repo="$(github_repo_from_remote "$remote" 2>/dev/null || true)"
  [ "$actual_repo" = "$expected_repo" ]
}

list_canonical_release_remotes() {
  git -C "$REPO_ROOT" remote | while IFS= read -r remote; do
    [ -n "$remote" ] || continue
    if remote_targets_github_repo "$remote" "$CANONICAL_RELEASE_GITHUB_REPO"; then
      printf '%s\n' "$remote"
    fi
  done
}

require_canonical_release_remote() {
  local remote="$1"
  local actual_repo

  if remote_targets_github_repo "$remote" "$CANONICAL_RELEASE_GITHUB_REPO"; then
    return
  fi

  actual_repo="$(github_repo_from_remote "$remote" 2>/dev/null || true)"
  release_fail "git remote '$remote' points to ${actual_repo:-<non-GitHub remote>}, but releases must target ${CANONICAL_RELEASE_GITHUB_REPO}."
}

resolve_release_remote() {
  local remote="${RELEASE_REMOTE:-${PUBLISH_REMOTE:-}}"
  local remotes=()
  local candidate

  if [ -n "$remote" ]; then
    git_remote_exists "$remote" || release_fail "git remote '$remote' does not exist."
    require_canonical_release_remote "$remote"
    printf '%s\n' "$remote"
    return
  fi

  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    git_remote_exists origin || release_fail "GitHub Actions releases require the canonical repository checkout with an origin remote."
    require_canonical_release_remote origin
    printf 'origin\n'
    return
  fi

  while IFS= read -r candidate; do
    [ -n "$candidate" ] || continue
    remotes+=("$candidate")
  done < <(list_canonical_release_remotes)

  if [ "${#remotes[@]}" -eq 0 ]; then
    release_fail "no git remote points at ${CANONICAL_RELEASE_GITHUB_REPO}. Add the canonical release remote and rerun with RELEASE_REMOTE=<remote-name>."
  fi

  if [ "${#remotes[@]}" -gt 1 ]; then
    release_fail "multiple git remotes point at ${CANONICAL_RELEASE_GITHUB_REPO}: ${remotes[*]}. Rerun with RELEASE_REMOTE=<remote-name>."
  fi

  release_fail "local release commands require an explicit canonical remote. Rerun with RELEASE_REMOTE=${remotes[0]} (or PUBLISH_REMOTE=${remotes[0]})."
}

fetch_release_remote() {
  git -C "$REPO_ROOT" fetch "$1" --prune --tags
}

git_current_branch() {
  git -C "$REPO_ROOT" symbolic-ref --quiet --short HEAD 2>/dev/null || true
}

git_local_tag_exists() {
  git -C "$REPO_ROOT" show-ref --verify --quiet "refs/tags/$1"
}

git_remote_tag_exists() {
  git -C "$REPO_ROOT" ls-remote --exit-code --tags "$2" "refs/tags/$1" >/dev/null 2>&1
}

get_last_stable_tag() {
  git -C "$REPO_ROOT" tag --list 'v*' --sort=-version:refname | head -1
}

get_current_stable_version() {
  local tag
  tag="$(get_last_stable_tag)"
  if [ -z "$tag" ]; then
    printf '0.0.0\n'
  else
    printf '%s\n' "${tag#v}"
  fi
}

stable_version_slot_for_date() {
  node - "${1:-}" <<'NODE'
const input = process.argv[2];

const date = input ? new Date(`${input}T00:00:00Z`) : new Date();
if (Number.isNaN(date.getTime())) {
  console.error(`invalid date: ${input}`);
  process.exit(1);
}

const month = String(date.getUTCMonth() + 1);
const day = String(date.getUTCDate()).padStart(2, '0');

process.stdout.write(`${date.getUTCFullYear()}.${month}${day}`);
NODE
}

utc_date_iso() {
  node <<'NODE'
const date = new Date();
const y = date.getUTCFullYear();
const m = String(date.getUTCMonth() + 1).padStart(2, '0');
const d = String(date.getUTCDate()).padStart(2, '0');
process.stdout.write(`${y}-${m}-${d}`);
NODE
}

next_stable_version() {
  local release_date="$1"
  shift

  node - "$release_date" "$@" <<'NODE'
const input = process.argv[2];
const packageNames = process.argv.slice(3);
const { execSync } = require("node:child_process");

const date = input ? new Date(`${input}T00:00:00Z`) : new Date();
if (Number.isNaN(date.getTime())) {
  console.error(`invalid date: ${input}`);
  process.exit(1);
}

const stableSlot = `${date.getUTCFullYear()}.${date.getUTCMonth() + 1}${String(date.getUTCDate()).padStart(2, "0")}`;
const pattern = new RegExp(`^${stableSlot.replace(/\./g, '\\.')}\.(\\d+)$`);
let max = -1;

for (const packageName of packageNames) {
  let versions = [];

  try {
    const raw = execSync(`npm view ${JSON.stringify(packageName)} versions --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (raw) {
      const parsed = JSON.parse(raw);
      versions = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    versions = [];
  }

  for (const version of versions) {
    const match = version.match(pattern);
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }
}

process.stdout.write(`${stableSlot}.${max + 1}`);
NODE
}

next_canary_version() {
  local stable_version="$1"
  shift

  node - "$stable_version" "$@" <<'NODE'
const stable = process.argv[2];
const packageNames = process.argv.slice(3);
const { execSync } = require("node:child_process");

const pattern = new RegExp(`^${stable.replace(/\./g, '\\.')}-canary\\.(\\d+)$`);
let max = -1;

for (const packageName of packageNames) {
  let versions = [];

  try {
    const raw = execSync(`npm view ${JSON.stringify(packageName)} versions --json`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (raw) {
      const parsed = JSON.parse(raw);
      versions = Array.isArray(parsed) ? parsed : [parsed];
    }
  } catch {
    versions = [];
  }
 
  for (const version of versions) {
    const match = version.match(pattern);
    if (!match) continue;
    max = Math.max(max, Number(match[1]));
  }
}

process.stdout.write(`${stable}-canary.${max + 1}`);
NODE
}

release_notes_file() {
  printf '%s/releases/v%s.md\n' "$REPO_ROOT" "$1"
}

stable_tag_name() {
  printf 'v%s\n' "$1"
}

canary_tag_name() {
  printf 'canary/v%s\n' "$1"
}

npm_package_version_exists() {
  local package_name="$1"
  local version="$2"
  local resolved

  resolved="$(npm view "${package_name}@${version}" version 2>/dev/null || true)"
  [ "$resolved" = "$version" ]
}

wait_for_npm_package_version() {
  local package_name="$1"
  local version="$2"
  local attempts="${3:-12}"
  local delay_seconds="${4:-5}"
  local attempt=1

  while [ "$attempt" -le "$attempts" ]; do
    if npm_package_version_exists "$package_name" "$version"; then
      return 0
    fi

    if [ "$attempt" -lt "$attempts" ]; then
      sleep "$delay_seconds"
    fi
    attempt=$((attempt + 1))
  done

  return 1
}

require_clean_worktree() {
  if [ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]; then
    release_fail "working tree is not clean. Commit, stash, or remove changes before releasing."
  fi
}

require_on_master_branch() {
  local current_branch
  current_branch="$(git_current_branch)"
  if [ "$current_branch" != "master" ]; then
    release_fail "this release step must run from branch master, but current branch is ${current_branch:-<detached>}."
  fi
}

require_npm_publish_auth() {
  local dry_run="$1"

  if [ "$dry_run" = true ]; then
    return
  fi

  if npm whoami >/dev/null 2>&1; then
    release_info "  ✓ Logged in to npm as $(npm whoami)"
    return
  fi

  if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
    release_info "  ✓ npm publish auth will be provided by GitHub Actions trusted publishing"
    return
  fi

  release_fail "npm publish auth is not available. Use 'npm login' locally or run from GitHub Actions with trusted publishing."
}

list_public_package_info() {
  node "$REPO_ROOT/scripts/release-package-map.mjs" list
}

set_public_package_version() {
  node "$REPO_ROOT/scripts/release-package-map.mjs" set-version "$1"
}
