#!/usr/bin/env bash
set -euo pipefail

# Compatibility entry point; the Node helper owns building and copying.
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
exec node "$REPO_ROOT/scripts/prepare-server-ui-dist.mjs"
