---
title: Setup Commands
summary: Onboard, run, doctor, and configure
---

Instance setup and diagnostics commands.

## `penclipai run`

One-command bootstrap and start:

```sh
pnpm penclipai run
```

Does:

1. Auto-onboards if config is missing
2. Runs `penclipai doctor` with repair enabled
3. Starts the server when checks pass

Choose a specific instance:

```sh
pnpm penclipai run --instance dev
```

## `penclipai onboard`

Interactive first-time setup:

```sh
pnpm penclipai onboard
```

First prompt:

1. `Quickstart` (recommended): local defaults (embedded database, no LLM provider, local disk storage, default secrets)
2. `Advanced setup`: full interactive configuration

Start immediately after onboarding:

```sh
pnpm penclipai onboard --run
```

Non-interactive defaults + immediate start (opens browser on server listen):

```sh
pnpm penclipai onboard --yes
```

## `penclipai doctor`

Health checks with optional auto-repair:

```sh
pnpm penclipai doctor
pnpm penclipai doctor --repair
```

Validates:

- Server configuration
- Database connectivity
- Secrets adapter configuration
- Storage configuration
- Missing key files

## `penclipai configure`

Update configuration sections:

```sh
pnpm penclipai configure --section server
pnpm penclipai configure --section secrets
pnpm penclipai configure --section storage
```

## `penclipai env`

Show resolved environment configuration:

```sh
pnpm penclipai env
```

## `penclipai allowed-hostname`

Allow a private hostname for authenticated/private mode:

```sh
pnpm penclipai allowed-hostname my-tailscale-host
```

## Local Storage Paths

| Data | Default Path |
|------|-------------|
| Config | `~/.paperclip/instances/default/config.json` |
| Database | `~/.paperclip/instances/default/db` |
| Logs | `~/.paperclip/instances/default/logs` |
| Storage | `~/.paperclip/instances/default/data/storage` |
| Secrets key | `~/.paperclip/instances/default/secrets/master.key` |

Override with:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm penclipai run
```

Or pass `--data-dir` directly on any command:

```sh
pnpm penclipai run --data-dir ./tmp/paperclip-dev
pnpm penclipai doctor --data-dir ./tmp/paperclip-dev
```
