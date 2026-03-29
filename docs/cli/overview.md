---
title: CLI Overview
summary: CLI installation and setup
---

The Paperclip CLI handles instance setup, diagnostics, and control-plane operations.

## Usage

```sh
pnpm penclipai --help
```

## Global Options

All commands support:

| Flag | Description |
|------|-------------|
| `--data-dir <path>` | Local Paperclip data root (isolates from `~/.paperclip`) |
| `--api-base <url>` | API base URL |
| `--api-key <token>` | API authentication token |
| `--context <path>` | Context file path |
| `--profile <name>` | Context profile name |
| `--json` | Output as JSON |

Company-scoped commands also accept `--company-id <id>`.

For clean local instances, pass `--data-dir` on the command you run:

```sh
pnpm penclipai run --data-dir ./tmp/paperclip-dev
```

## Context Profiles

Store defaults to avoid repeating flags:

```sh
# Set defaults
pnpm penclipai context set --api-base http://localhost:3100 --company-id <id>

# View current context
pnpm penclipai context show

# List profiles
pnpm penclipai context list

# Switch profile
pnpm penclipai context use default
```

To avoid storing secrets in context, use an env var:

```sh
pnpm penclipai context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

Context is stored at `~/.paperclip/context.json`.

## Command Categories

The CLI has two categories:

1. **[Setup commands](/cli/setup-commands)** — instance bootstrap, diagnostics, configuration
2. **[Control-plane commands](/cli/control-plane-commands)** — issues, agents, approvals, activity
