# CLI Reference

Paperclip CLI now supports both:

- installation and lifecycle management (`install`, `uninstall`, `update`, `upgrade`, `service`)
- instance setup/diagnostics (`onboard`, `doctor`, `configure`, `env`, `allowed-hostname`, `env-lab`)
- control-plane client operations (issues, approvals, agents, activity, dashboard)

## Base Usage

Use repo script in development:

```sh
pnpm penclip --help
```

Recommended installation and interactive onboarding:

```sh
curl -fsSLO https://paperclip.ing/install.sh
curl -fsSLO https://paperclip.ing/install.sh.sha256
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c install.sh.sha256
else
  shasum -a 256 -c install.sh.sha256
fi
bash install.sh
```

The checksum detects transfer or publishing mistakes but is served from the
same origin as the installer. Use a release-tag or commit-pinned GitHub copy
when you need an independently hosted source. Piped installs require supported
Node.js, npm, and npx to already be installed; download the script first before
allowing it to bootstrap Node.js with privileged package-manager commands.

First-time local bootstrap from a source checkout:

```sh
pnpm penclip run
```

Choose local instance:

```sh
pnpm penclip run --instance dev
```

## Install, Update, And Uninstall

Managed installs keep CLI payloads under `~/.paperclip/cli`, expose a stable
`~/.local/bin/paperclipai` shim, switch versions atomically, and retain two
previous payloads for rollback.

```sh
paperclipai install
paperclipai install --canary
paperclipai install --version <version>
paperclipai install --ref <branch|tag|sha> [--repo owner/repo]
paperclipai update
paperclipai update --latest|--canary|--version <version>
paperclipai update --rollback
paperclipai upgrade
paperclipai uninstall
```

`upgrade` aliases `update`. `uninstall` removes managed code and the shim but
preserves instance data under `~/.paperclip/instances/`. See
`doc/INSTALLING.md` for installation methods, security notes, PATH setup, and
the complete update and rollback behavior.

## Onboarding And Service Management

Interactive onboarding offers to install a background service on supported
platforms. `--yes` never installs it implicitly; automation must opt in.

```sh
paperclipai onboard
paperclipai onboard --yes
paperclipai onboard --yes --install-service
paperclipai onboard --yes --no-install-service
```

Service lifecycle commands remain under the `service` namespace:

```sh
paperclipai service install [--no-start-now] [--no-start-on-login]
paperclipai service uninstall
paperclipai service start
paperclipai service stop
paperclipai service restart [--wait]
paperclipai service status [--json]
paperclipai service logs [-f]
```

Every service verb supports `--instance <id>` and `--json`. Linux and WSL2 use
a systemd user unit when available; macOS uses a LaunchAgent. Unsupported
environments receive foreground `paperclipai run` guidance.

`paperclipai doctor` includes managed-install and service-health diagnostics in
addition to configuration, storage, database, logging, and port checks.

## Deployment Modes

Mode taxonomy and design intent are documented in `doc/DEPLOYMENT-MODES.md`.

Current CLI behavior:

- `paperclipai onboard` and `paperclipai configure --section server` set deployment mode in config
- server onboarding/configure ask for reachability intent and write `server.bind`
- `paperclipai run --bind <loopback|lan|tailnet>` passes a quickstart bind preset into first-run onboarding when config is missing
- runtime can override mode with `PAPERCLIP_DEPLOYMENT_MODE`
- `paperclipai run` and `paperclipai doctor` still do not expose a direct low-level `--mode` flag

Canonical behavior is documented in `doc/DEPLOYMENT-MODES.md`.

Allow an authenticated/private hostname (for example custom Tailscale DNS):

```sh
pnpm penclip allowed-hostname dotta-macbook-pro
```

Bring up the default local SSH fixture for environment testing:

```sh
pnpm penclip env-lab up
pnpm penclip env-lab doctor
pnpm penclip env-lab status --json
pnpm penclip env-lab down
```

All client commands support:

- `--data-dir <path>`
- `--api-base <url>`
- `--api-key <token>`
- `--context <path>`
- `--profile <name>`
- `--json`

Company-scoped commands also support `--company-id <id>`.

API base resolution order:

1. `--api-base <url>`
2. `PAPERCLIP_API_URL`
3. selected context profile `apiBase`
4. local Paperclip config server port
5. `http://localhost:3100`

Connection failures include the attempted URL and a `GET /api/health` check hint.

## Connect Wizard

```sh
pnpm penclip connect
```

`connect` confirms the resolved API base, verifies `GET /api/health`, authenticates board access when needed, and saves a persona-aware profile:

- `persona=board` for board operator profiles
- `persona=agent` with `agentId` and `agentName` for agent profiles

Profiles store token env-var names, not plaintext tokens. The wizard prints shell exports for the newly created token.

Use `--data-dir` on any CLI command to isolate all default local state (config/context/db/logs/storage/secrets) away from `~/.paperclip`:

```sh
pnpm penclip run --data-dir ./tmp/paperclip-dev
pnpm penclip issue list --data-dir ./tmp/paperclip-dev
```

## Context Profiles

Store local defaults in `~/.paperclip/context.json`:

```sh
pnpm penclip context set --api-base http://localhost:3100 --company-id <company-id>
pnpm penclip context set --persona agent --agent-id <agent-id> --api-key-env-var-name PAPERCLIP_API_KEY
pnpm penclip context show
pnpm penclip context list
pnpm penclip context use default
```

To avoid storing secrets in context, set `apiKeyEnvVarName` and keep the key in env:

```sh
pnpm penclip context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

## Company Commands

```sh
pnpm penclip company list
pnpm penclip company get <company-id>
pnpm penclip company current [--company-id <company-id>]
pnpm penclip company stats
pnpm penclip company create --payload-json '{...}'
pnpm penclip company update <company-id> --payload-json '{...}'
pnpm penclip company branding:update <company-id> --payload-json '{...}'
pnpm penclip company archive <company-id>
pnpm penclip company export <company-id> --out ./company --include company,agents,projects,issues,skills
pnpm penclip company export:preview <company-id> --payload-json '{...}'
pnpm penclip company export:api <company-id> --payload-json '{...}'
pnpm penclip company import ./company --target new --new-company-name "Imported Company"
pnpm penclip company import:preview <company-id> --payload-json '{...}'
pnpm penclip company import:apply <company-id> --payload-json '{...}'
pnpm penclip company delete <company-id-or-prefix> --yes --confirm <same-id-or-prefix>
```

Examples:

```sh
pnpm penclip company delete PAP --yes --confirm PAP
pnpm penclip company delete 5cbe79ee-acb3-4597-896e-7662742593cd --yes --confirm 5cbe79ee-acb3-4597-896e-7662742593cd
```

Notes:

- With agent authentication, `company list` and `company current` are
  agent-safe company selectors. `company list` first tries the board-wide list;
  if that is forbidden, it uses `--company-id`, `PAPERCLIP_COMPANY_ID`, context,
  or `/api/agents/me` and then reads only that scoped company.
- `company create` requires board/instance-admin authentication because it is
  an instance-wide setup command.
- Deletion is server-gated by `PAPERCLIP_ENABLE_COMPANY_DELETION`.
- With agent authentication, company deletion is company-scoped. Use the current company ID/prefix (for example via `--company-id` or `PAPERCLIP_COMPANY_ID`), not another company.

## Issue Commands

```sh
pnpm penclip issue list --company-id <company-id> [--status todo,in_progress] [--assignee-agent-id <agent-id>] [--match text]
pnpm penclip issue get <issue-id-or-identifier>
pnpm penclip issue create --company-id <company-id> --title "..." [--description "..."] [--status todo] [--priority high]
pnpm penclip issue update <issue-id> [--status in_progress] [--comment "..."]
pnpm penclip issue delete <issue-id> --yes
pnpm penclip issue comment <issue-id> --body "..." [--reopen]
pnpm penclip issue comments <issue-id> [--limit 50]
pnpm penclip issue comment:get <issue-id> <comment-id>
pnpm penclip issue comment:delete <issue-id> <comment-id>
pnpm penclip issue runs <issue-id-or-identifier>
pnpm penclip issue live-runs <issue-id-or-identifier>
pnpm penclip issue active-run <issue-id-or-identifier>
pnpm penclip issue heartbeat-context <issue-id>
pnpm penclip issue checkout <issue-id> --agent-id <agent-id> [--expected-statuses todo,backlog,blocked]
pnpm penclip issue release <issue-id>
pnpm penclip issue force-release <issue-id>
```

Issue subresources are exposed as Paperclip API wrappers. Commands that map to broad server schemas accept JSON payloads and validate them with shared schemas before sending.

```sh
pnpm penclip issue child:create <issue-id> --payload-json '{"title":"Child task"}'
pnpm penclip issue approvals <issue-id>
pnpm penclip issue approval:link <issue-id> <approval-id>
pnpm penclip issue approval:unlink <issue-id> <approval-id>
pnpm penclip issue read <issue-id>
pnpm penclip issue unread <issue-id>
pnpm penclip issue archive <issue-id>
pnpm penclip issue unarchive <issue-id>
pnpm penclip issue recovery-actions <issue-id>
pnpm penclip issue recovery:resolve <issue-id> --outcome restored --source-issue-status todo
```

```sh
pnpm penclip issue documents <issue-id> [--include-system]
pnpm penclip issue document:get <issue-id> <key>
pnpm penclip issue document:put <issue-id> <key> --body-file ./plan.md [--title Plan]
pnpm penclip issue document:lock <issue-id> <key>
pnpm penclip issue document:unlock <issue-id> <key>
pnpm penclip issue document:revisions <issue-id> <key>
pnpm penclip issue document:restore <issue-id> <key> <revision-id>
pnpm penclip issue document:delete <issue-id> <key>
```

```sh
pnpm penclip issue work-products <issue-id>
pnpm penclip issue work-product:create <issue-id> --payload-json '{"type":"pull_request","provider":"github","title":"PR"}'
pnpm penclip issue work-product:update <work-product-id> --payload-json '{"status":"archived"}'
pnpm penclip issue work-product:delete <work-product-id>
pnpm penclip issue interactions <issue-id>
pnpm penclip issue interaction:create <issue-id> --payload-json '{"kind":"request_confirmation","payload":{"version":1,"prompt":"Continue?"}}'
pnpm penclip issue interaction:accept <issue-id> <interaction-id> [--selected-client-keys key1,key2]
pnpm penclip issue interaction:reject <issue-id> <interaction-id> [--reason "..."]
pnpm penclip issue interaction:respond <issue-id> <interaction-id> --answers-json '[{"questionId":"q1","optionIds":["yes"]}]'
pnpm penclip issue interaction:cancel <issue-id> <interaction-id> [--reason "..."]
```

```sh
pnpm penclip issue tree-state <issue-id>
pnpm penclip issue tree-preview <issue-id> --payload-json '{"mode":"pause"}'
pnpm penclip issue tree-holds <issue-id> [--status active] [--include-members]
pnpm penclip issue tree-hold:create <issue-id> --payload-json '{"mode":"pause","reason":"review"}'
pnpm penclip issue tree-hold:get <issue-id> <hold-id>
pnpm penclip issue tree-hold:release <issue-id> <hold-id> [--payload-json '{"reason":"done"}']
pnpm penclip issue attachments <issue-id>
pnpm penclip issue attachment:upload <issue-id> --company-id <company-id> --file ./artifact.txt
pnpm penclip issue attachment:download <attachment-id> [--out ./artifact.txt]
pnpm penclip issue attachment:delete <attachment-id>
pnpm penclip issue label:list --company-id <company-id>
pnpm penclip issue label:create --company-id <company-id> --name bug --color '#ff0000'
pnpm penclip issue label:delete <label-id>
pnpm penclip issue feedback:votes <issue-id>
pnpm penclip issue feedback:vote <issue-id> --payload-json '{"targetType":"issue_comment","targetId":"...","vote":"up"}'
```

## Project Commands

```sh
pnpm penclip project list --company-id <company-id>
pnpm penclip project get <project-id-or-shortname> [--company-id <company-id>]
pnpm penclip project create --company-id <company-id> --name "Launch Site" [--goal-ids <id1,id2>] [--lead-agent-id <id>]
pnpm penclip project update <project-id-or-shortname> [--status in_progress] [--company-id <company-id>]
pnpm penclip project delete <project-id-or-shortname> --yes [--company-id <company-id>]
```

Advanced project fields accept JSON:

```sh
pnpm penclip project create --company-id <company-id> --name "Ops" --env-json '{"OPENAI_API_KEY":{"kind":"secret","secretName":"openai-api-key"}}'
pnpm penclip project update <project-id> --execution-workspace-policy-json '{"enabled":true,"defaultMode":"shared_workspace"}'
```

## Goal Commands

```sh
pnpm penclip goal list --company-id <company-id>
pnpm penclip goal get <goal-id>
pnpm penclip goal create --company-id <company-id> --title "Grow revenue" [--level company] [--status active]
pnpm penclip goal update <goal-id> [--title "..."] [--status achieved]
pnpm penclip goal delete <goal-id> --yes
```

## Agent Commands

```sh
pnpm penclip agent list --company-id <company-id>
pnpm penclip agent get <agent-id>
pnpm penclip agent create --company-id <company-id> --payload-json '{"name":"Builder","adapterType":"codex_local"}'
pnpm penclip agent hire --company-id <company-id> --payload-json '{...}'
pnpm penclip agent update <agent-id> --payload-json '{"title":"Senior Builder"}'
pnpm penclip agent delete <agent-id> --yes
pnpm penclip agent me
pnpm penclip agent inbox
pnpm penclip agent inbox-mine --user-id <board-user-id>
pnpm penclip agent wake <agent-id-or-shortname> [--company-id <company-id>] [--reason "..."] [--payload '{"issueId":"..."}']
pnpm penclip agent pause <agent-id>
pnpm penclip agent resume <agent-id>
pnpm penclip agent approve <agent-id>
pnpm penclip agent terminate <agent-id>
pnpm penclip agent heartbeat:invoke <agent-id>
pnpm penclip agent claude-login <agent-id>
pnpm penclip agent local-cli <agent-id-or-shortname> --company-id <company-id>
```

Agent configuration and runtime endpoints:

```sh
pnpm penclip agent permissions:update <agent-id> --payload-json '{"canCreateAgents":true,"canCreateSkills":true,"canAssignTasks":true}'
pnpm penclip agent configuration <agent-id>
pnpm penclip agent config-revisions <agent-id>
pnpm penclip agent config-revision:get <agent-id> <revision-id>
pnpm penclip agent config-revision:rollback <agent-id> <revision-id>
pnpm penclip agent runtime-state <agent-id>
pnpm penclip agent runtime-state:reset-session <agent-id> [--task-key <key>]
pnpm penclip agent task-sessions <agent-id>
pnpm penclip agent skills <agent-id>
pnpm penclip agent skills:sync <agent-id> --desired-skills paperclip,github
pnpm penclip agent instructions-path:update <agent-id> --payload-json '{"path":"/path/to/AGENTS.md"}'
pnpm penclip agent instructions-bundle <agent-id>
pnpm penclip agent instructions-bundle:update <agent-id> --payload-json '{"mode":"managed"}'
pnpm penclip agent instructions-file:get <agent-id> --path AGENTS.md
pnpm penclip agent instructions-file:put <agent-id> --path AGENTS.md --content-file ./AGENTS.md
pnpm penclip agent instructions-file:delete <agent-id> --path AGENTS.md
```

Agent config, instructions, skills, project env, environment, secret, and workspace edits affect the next run. Active runs finish with the config they started with. When a saved session, reused workspace, or sandbox lease no longer matches the effective next-run config, Paperclip may start fresh execution and records non-sensitive freshness categories in run result JSON and workspace operation logs.

`agent local-cli` is the quickest way to run local Claude/Codex manually as a Paperclip agent:

- creates a new long-lived agent API key
- installs missing Paperclip skills into `~/.codex/skills` and `~/.claude/skills`
- prints `export ...` lines for `PAPERCLIP_API_URL`, `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_AGENT_ID`, and `PAPERCLIP_API_KEY`

Example for shortname-based local setup:

```sh
pnpm penclip agent local-cli codexcoder --company-id <company-id>
pnpm penclip agent local-cli claudecoder --company-id <company-id>
```

## Token Commands

Agent API keys are scoped to one company and one agent. Plaintext tokens are printed once at creation.

```sh
pnpm penclip token agent create --company-id <company-id> --agent <agent-id-or-name> --name external-worker
pnpm penclip token agent list --company-id <company-id> --agent <agent-id-or-name>
pnpm penclip token agent revoke --company-id <company-id> --agent <agent-id-or-name> <key-id>
```

Named board API keys use the board authorization model, support revocation and expiration metadata, and are audited server-side.

```sh
pnpm penclip token board create --company-id <company-id> --name external-admin
pnpm penclip token board create --name short-lived --ttl-days 7
pnpm penclip token board list
pnpm penclip token board revoke <key-id>
```

## Run Commands

`paperclipai run` without a subcommand still bootstraps and starts a local Paperclip instance. The subcommands below inspect and control API heartbeat runs.

```sh
pnpm penclip run list --company-id <company-id> [--agent-id <agent-id>] [--limit 50]
pnpm penclip run live --company-id <company-id> [--limit 50] [--min-count 0]
pnpm penclip run get <run-id>
pnpm penclip run events <run-id> [--after-seq 0] [--limit 200]
pnpm penclip run log <run-id> [--offset 0] [--limit-bytes 16384] [--text]
pnpm penclip run cancel <run-id>
pnpm penclip run issues <run-id>
pnpm penclip run workspace-operations <run-id>
pnpm penclip run workspace-log <operation-id> [--offset 0] [--limit-bytes 16384] [--text]
pnpm penclip run watchdog-decision <run-id> --decision continue [--reason "..."]
```

## Routine Commands

`paperclipai routines disable-all` remains the local maintenance command. The singular `routine` group maps to the REST API.

```sh
pnpm penclip routine list --company-id <company-id> [--project-id <project-id>]
pnpm penclip routine create --company-id <company-id> --payload-json '{...}'
pnpm penclip routine get <routine-id>
pnpm penclip routine update <routine-id> --payload-json '{...}'
pnpm penclip routine revisions <routine-id>
pnpm penclip routine revision:restore <routine-id> <revision-id>
pnpm penclip routine runs <routine-id> [--limit 50]
pnpm penclip routine run <routine-id> [--payload-json '{...}']
pnpm penclip routine trigger:create <routine-id> --payload-json '{...}'
pnpm penclip routine trigger:update <trigger-id> --payload-json '{...}'
pnpm penclip routine trigger:delete <trigger-id>
pnpm penclip routine trigger:rotate-secret <trigger-id>
pnpm penclip routine trigger:fire <public-id> [--payload-json '{...}']
```

## Prompt Handoff

Prompt handoff creates Paperclip work. It does not create a chat session.

```sh
pnpm penclip agent-prompt <agent-name-or-id> <agent-api-key> "Prompt here"
pnpm penclip agent prompt --agent <agent-name-or-id> --api-key-env PAPERCLIP_API_KEY "Prompt here"
pnpm penclip agent prompt --profile my-agent "Prompt here"
pnpm penclip board prompt --company-id <company-id> --agent <agent-name-or-id> "Prompt here"
```

By default the command creates a `todo` issue assigned to the target agent and wakes the agent. Use `--issue <issue-id>` to add a comment to existing work, and `--no-wake` to skip the wakeup.

## Skills Commands

`paperclipai skills` covers three distinct operations:

1. **Company install** — adds or updates a row in `company_skills` for the
   whole company. This is what `skills install`, `skills import`, `skills create`,
   and `skills scan-projects` do.
2. **Agent attach** — replaces an agent's *desired* company skill set
   (`skills agent sync`/`clear`). This is a desired-state operation on the
   agent's adapter config; it does not change the company library.
3. **Adapter runtime sync** — the adapter reconciles the desired skill set
   with files on disk and reports an `AgentSkillSnapshot` (`skills agent list`).
   `skills agent sync` triggers this automatically after updating desired state.

Required Paperclip runtime skills (heartbeat, etc.) remain server-enforced and
are added on top of whatever the desired set names.

Company skill mutations (`skills install`, `skills import`, `skills create`, and
`skills scan-projects`) are open to same-company actors by default. Missing
`skills:create` grants and `canCreateSkills` settings do not deny these commands;
only an explicit company skill policy restriction does. Core safety and company
boundary checks still apply, and `agents:create` remains required when a command
also creates agents.

### Catalog (app-shipped skills)

The Paperclip app ships a curated catalog under `@penclipai/skills-catalog`.
Browse and inspect commands never mutate company state; `install` adds a catalog
skill to the company library.

```sh
pnpm penclip skills browse [--kind bundled|optional] [--category <slug>] [--query <text>]
pnpm penclip skills search "<text>" [--kind bundled|optional] [--category <slug>]
pnpm penclip skills inspect <catalog-id-or-key-or-slug>
pnpm penclip skills install <catalog-id-or-key-or-slug> [--as <slug>] [--force] --company-id <company-id>
```

Catalog semantics:

- **Bundled** skills live in `packages/skills-catalog/catalog/bundled/<category>/<slug>`
  and are recommended defaults for most companies. They use canonical key
  `paperclipai/bundled/<category>/<slug>`.
- **Optional** skills live in `packages/skills-catalog/catalog/optional/<category>/<slug>`
  and are role-specific or domain-specific (browser, AWS ops, etc.). Same key
  shape with `optional` in place of `bundled`.
- `skills install` materializes the catalog files into a company-managed skill
  directory and records provenance (`catalogId`, `catalogKey`, `packageVersion`,
  `originHash`, …) so future updates and audit decisions stay consistent.
- `--as <slug>` overrides the company skill slug. `--force` may replace a
  same-key catalog-managed skill but never bypasses hard validation or hard-stop
  audit findings.

Examples:

```sh
pnpm penclip skills browse --kind bundled --company-id <company-id>
pnpm penclip skills search "pull request" --kind bundled
pnpm penclip skills inspect github-pr-workflow
pnpm penclip skills install github-pr-workflow --company-id <company-id>
pnpm penclip skills install paperclipai:optional:browser:agent-browser --company-id <company-id>
```

External GitHub, skills.sh, local-path, and URL sources still go through
`skills import`; catalog commands are for the app-shipped catalog only.

### Company library

```sh
pnpm penclip skills list --company-id <company-id>
pnpm penclip skills show <skill-id-or-key-or-slug> --company-id <company-id>
pnpm penclip skills file <skill-id-or-key-or-slug> [--path SKILL.md] --company-id <company-id>
pnpm penclip skills import <source> --company-id <company-id>
pnpm penclip skills create --name "Review PRs" [--slug review-prs] [--description "..."] [--body-file SKILL.md] --company-id <company-id>
pnpm penclip skills scan-projects [--project-id <id>...] [--workspace-id <id>...] --company-id <company-id>
pnpm penclip skills check [skill-id-or-key-or-slug] --company-id <company-id>
pnpm penclip skills update <skill-id-or-key-or-slug> [--force] --company-id <company-id>
pnpm penclip skills update --all [--force] --company-id <company-id>
pnpm penclip skills audit [skill-id-or-key-or-slug] --company-id <company-id>
pnpm penclip skills reset <skill-id-or-key-or-slug> [--yes] [--force] --company-id <company-id>
pnpm penclip skills remove <skill-id-or-key-or-slug> --yes --company-id <company-id>
```

`skills import <source>` accepts a skills.sh URL, the equivalent
`<owner>/<repo>/<skill>` shorthand, a GitHub URL, a local path, or an
`npx skills add …` command. See `references/company-skills.md` in the agent
skill bundle for the source-type table.

`skills check`, `skills update`, `skills audit`, and `skills reset` are the
maintenance loop for catalog-installed skills:

- `check` reports whether each skill's installed bytes match its pinned origin
  (`hasUpdate`, `installedHash`, `originHash`, `updateHoldReason`,
  `auditVerdict`).
- `update` installs the pinned update through the existing install-update API.
  `--all` checks every company skill and updates only those with
  `hasUpdate=true`. `--force` discards local-modification or soft-audit holds;
  hard-stop audit findings still block the update.
- `audit` re-scans installed bytes and reports findings without executing
  anything.
- `reset` reinstalls a catalog-managed skill from its pinned origin, discarding
  local edits. Prompts in a TTY; requires `--yes` for non-interactive use.

### Agent attach

```sh
pnpm penclip skills agent list <agent-id-or-shortname> --company-id <company-id>
pnpm penclip skills agent sync <agent-id-or-shortname> --skill <skill-id-or-key-or-slug> [--skill <skill-id-or-key-or-slug>...] --company-id <company-id>
pnpm penclip skills agent clear <agent-id-or-shortname> --yes --company-id <company-id>
```

`skills agent sync` replaces the agent's non-required desired skill set (it is
not additive) and returns the resulting adapter `AgentSkillSnapshot`.
`skills agent clear` sends an empty desired list. Required Paperclip skills are
still enforced by the server in both cases.

### Notes

- Skill references accept company skill `id`, canonical `key`, or unique
  `slug`; catalog references accept catalog `id`, `key`, or unique `slug`.
- `skills file` prints raw file content in human mode so it can be piped.
- `skills create --body-file -` reads the skill markdown body from stdin.
- `skills remove`, `skills reset`, and `skills agent clear` prompt in a TTY and
  require `--yes` in non-interactive use.
- `--json` prints the raw API result for each command.

## Teams Commands

`paperclipai teams` works with the app-shipped team catalog in
`@penclipai/teams-catalog`. Browse, search, inspect, and file reads do not
change company state. `preview` runs the company import planner, and `install`
imports the catalog team into an existing company.

```sh
pnpm penclip teams browse [--kind bundled|optional] [--category <slug>] [--query <text>]
pnpm penclip teams search "<text>" [--kind bundled|optional] [--category <slug>]
pnpm penclip teams inspect <catalog-id-or-key-or-slug> [--file TEAM.md]
pnpm penclip teams preview <catalog-id-or-key-or-slug> --company-id <company-id>
pnpm penclip teams install <catalog-id-or-key-or-slug> --company-id <company-id>
```

Preview/install options:

- Under agent authentication, use `paperclipai company list --json`,
  `paperclipai company current --json`, or `PAPERCLIP_COMPANY_ID` to select the
  target company. `company list` falls back to the scoped current company when
  board-wide listing is forbidden. `teams install` creates agents and therefore
  requires board authentication, an `agents:create` grant, or an agent with
  explicit `canCreateAgents` permission.
- `--request-approval-on-forbidden` turns a 403 install denial into a linked
  board approval request instead of a raw failed command; use
  `--approval-issue-id <id>` to attach it to a specific issue. During Paperclip
  task runs with `PAPERCLIP_TASK_ID` set, this fallback is automatic so
  agent-run walkthroughs leave a pending approval path instead of a raw 403.
- `--target-manager-agent-id <id>` or `--target-manager-slug <slug>` reparents
  catalog root agents under an existing manager.
- `--agent <slug>` and `--selected-file <path>` narrow the import.
- `--collision-strategy rename|skip|replace` controls name/key collisions.
- `--allow-external-sources`, `--allow-unpinned-optional-sources`, and
  `--allow-local-path-sources` explicitly opt into higher-trust source policy.
  Local-path sources are development-only and stay blocked unless that flag is
  passed.

## Secrets Commands

```sh
pnpm penclip secrets list --company-id <company-id>
pnpm penclip secrets declarations --company-id <company-id> [--include agents,projects] [--kind secret]
pnpm penclip secrets create --company-id <company-id> --name anthropic-api-key --value-env ANTHROPIC_API_KEY
pnpm penclip secrets link --company-id <company-id> --name prod-stripe-key --provider aws_secrets_manager --external-ref <provider-ref>
pnpm penclip secrets doctor --company-id <company-id>
pnpm penclip secrets provider-configs --company-id <company-id>
pnpm penclip secrets provider-config:create --company-id <company-id> --payload-json '{...}'
pnpm penclip secrets provider-config:discovery-preview --company-id <company-id> --payload-json '{...}'
pnpm penclip secrets provider-config:get <config-id>
pnpm penclip secrets provider-config:update <config-id> --payload-json '{...}'
pnpm penclip secrets provider-config:default <config-id>
pnpm penclip secrets provider-config:health <config-id>
pnpm penclip secrets provider-config:delete <config-id>
pnpm penclip secrets remote-import:preview --company-id <company-id> --payload-json '{...}'
pnpm penclip secrets remote-import --company-id <company-id> --payload-json '{...}'
pnpm penclip secrets migrate-inline-env --company-id <company-id> [--apply]
```

Secret listing and declarations never print secret values. `create` accepts
`--value-env` so shell history does not capture the value. `link` records
provider-owned references without copying the secret value into Paperclip.
For AWS-backed secrets, `secrets doctor` reports missing non-secret provider
env and the expected AWS SDK runtime credential source; do not store AWS
bootstrap credentials in Paperclip secrets.

Per-company provider vaults (multiple vault instances per provider, default
vault selection, coming-soon GCP/Vault) can be configured from the board UI under
`Company Settings → Secrets → Provider vaults` or through the provider-config CLI
commands above. See the
[secrets deploy guide](../docs/deploy/secrets.md#provider-vaults) and
[API reference](../docs/api/secrets.md#provider-vaults) for the contract.

## Approval Commands

```sh
pnpm penclip approval list --company-id <company-id> [--status pending]
pnpm penclip approval get <approval-id>
pnpm penclip approval create --company-id <company-id> --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]
pnpm penclip approval approve <approval-id> [--decision-note "..."]
pnpm penclip approval reject <approval-id> [--decision-note "..."]
pnpm penclip approval request-revision <approval-id> [--decision-note "..."]
pnpm penclip approval resubmit <approval-id> [--payload '{"...":"..."}']
pnpm penclip approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm penclip activity list --company-id <company-id> [--agent-id <agent-id>] [--entity-type issue] [--entity-id <id>]
pnpm penclip activity create --company-id <company-id> --payload-json '{...}'
pnpm penclip activity issue <issue-id>
```

## Dashboard Commands

```sh
pnpm penclip dashboard get --company-id <company-id>
```

## Org And Agent Config Commands

```sh
pnpm penclip whoami
pnpm penclip openapi
pnpm penclip org get --company-id <company-id>
pnpm penclip org svg --company-id <company-id> [--out org.svg]
pnpm penclip org png --company-id <company-id> [--out org.png]
pnpm penclip agent-config list --company-id <company-id>
```

## Access, Profile, And Instance Commands

```sh
pnpm penclip profile session
pnpm penclip profile get
pnpm penclip profile update --payload-json '{...}'
pnpm penclip profile company-user <user-slug> --company-id <company-id>
pnpm penclip invite list --company-id <company-id>
pnpm penclip invite create --company-id <company-id> --payload-json '{...}'
pnpm penclip invite revoke <invite-id>
pnpm penclip invite show <token>
pnpm penclip invite accept <token> [--payload-json '{...}']
pnpm penclip invite onboarding:text <token>
pnpm penclip join list --company-id <company-id> [--status pending_approval]
pnpm penclip join approve <request-id> --company-id <company-id>
pnpm penclip join reject <request-id> --company-id <company-id>
pnpm penclip join claim-key <request-id> --claim-secret <secret>
pnpm penclip member list --company-id <company-id>
pnpm penclip member update <member-id> --company-id <company-id> --payload-json '{...}'
pnpm penclip member role-and-grants <member-id> --company-id <company-id> --payload-json '{...}'
pnpm penclip member permissions <member-id> --company-id <company-id> --payload-json '{...}'
pnpm penclip member archive <member-id> --company-id <company-id> [--payload-json '{...}']
pnpm penclip admin user list [--query <text>]
pnpm penclip admin user promote <user-id>
pnpm penclip admin user demote <user-id>
pnpm penclip admin user company-access <user-id>
pnpm penclip admin user company-access:update <user-id> --payload-json '{...}'
```

CLI auth challenge endpoints are also exposed for tooling that needs the raw challenge lifecycle:

```sh
pnpm penclip auth challenge create --payload-json '{...}'
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> pnpm penclip auth challenge get <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> pnpm penclip auth challenge approve <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
PAPERCLIP_CHALLENGE_SECRET=<challenge-secret> pnpm penclip auth challenge cancel <challenge-id> --token-env PAPERCLIP_CHALLENGE_SECRET
pnpm penclip auth revoke-current
```

`--token <challenge-secret>` is still supported for compatibility, but `--token-env` avoids putting challenge secrets in shell history or process arguments.

## Instance Settings Commands

```sh
pnpm penclip instance scheduler-heartbeats
pnpm penclip instance settings:general
pnpm penclip instance settings:general:update --payload-json '{...}'
pnpm penclip instance settings:experimental
pnpm penclip instance settings:experimental:update --payload-json '{...}'
pnpm penclip instance database-backup
```

Experimental features are opt-in and are provided without compatibility guarantees. They may break, change, or be removed at any time. Use them at your own risk.

```sh
pnpm penclip sidebar preferences
pnpm penclip sidebar preferences:update --payload-json '{...}'
pnpm penclip sidebar project-preferences --company-id <company-id>
pnpm penclip sidebar project-preferences:update --company-id <company-id> --payload-json '{...}'
pnpm penclip sidebar badges --company-id <company-id>
pnpm penclip inbox dismissals --company-id <company-id>
pnpm penclip inbox dismiss --company-id <company-id> --payload-json '{"itemKey":"run:<run-id>"}'
pnpm penclip board-claim show <token>
pnpm penclip board-claim claim <token> [--payload-json '{...}']
pnpm penclip openclaw invite-prompt --company-id <company-id> --payload-json '{...}'
pnpm penclip available-skill list
pnpm penclip available-skill index
pnpm penclip available-skill get <skill-name>
pnpm penclip llm agent-configuration
pnpm penclip llm agent-configuration:adapter <adapter-type>
pnpm penclip llm agent-icons
```

Hermes gateway uses the generic invite/join commands above rather than
`openclaw invite-prompt`. Create an agent invite, read
`invite onboarding:text`, submit a join request with
`adapterType: "hermes_gateway"` and `agentDefaultsPayload.apiBaseUrl` /
`agentDefaultsPayload.apiKey`, then approve and claim the key with the `join`
commands. Install a Hermes gateway adapter plugin first so the type key is
available at runtime.

## Adapter, Asset, And Skill Commands

```sh
pnpm penclip adapter list
pnpm penclip adapter install --payload-json '{"packageName":"@scope/adapter","version":"1.2.3"}'
pnpm penclip adapter get <adapter-type>
pnpm penclip adapter update <adapter-type> --payload-json '{"disabled":true}'
pnpm penclip adapter override <adapter-type> --payload-json '{"paused":true}'
pnpm penclip adapter reload <adapter-type>
pnpm penclip adapter reinstall <adapter-type>
pnpm penclip adapter delete <adapter-type>
pnpm penclip adapter config-schema <adapter-type>
pnpm penclip adapter ui-parser <adapter-type>
pnpm penclip adapter models <adapter-type> --company-id <company-id> [--refresh] [--environment-id <id>]
pnpm penclip adapter model-profiles <adapter-type> --company-id <company-id>
pnpm penclip adapter detect-model <adapter-type> --company-id <company-id>
pnpm penclip adapter test-environment <adapter-type> --company-id <company-id> --payload-json '{...}'
```

```sh
pnpm penclip asset image:upload --company-id <company-id> --file ./image.png [--namespace docs] [--alt "..."]
pnpm penclip asset logo:upload --company-id <company-id> --file ./logo.svg
pnpm penclip asset content <asset-id> --out ./asset.bin
```

```sh
pnpm penclip skill list --company-id <company-id>
pnpm penclip skill get <skill-id> --company-id <company-id>
pnpm penclip skill file <skill-id> --company-id <company-id> [--path SKILL.md]
pnpm penclip skill create --company-id <company-id> --payload-json '{...}'
pnpm penclip skill file:update <skill-id> --company-id <company-id> --payload-json '{...}'
pnpm penclip skill import --company-id <company-id> --payload-json '{"source":"github:owner/repo/path"}'
pnpm penclip skill scan-projects --company-id <company-id> --payload-json '{...}'
pnpm penclip skill update-status <skill-id> --company-id <company-id>
pnpm penclip skill install-update <skill-id> --company-id <company-id>
pnpm penclip skill delete <skill-id> --company-id <company-id>
```

## Cost, Finance, And Budget Commands

```sh
pnpm penclip cost summary --company-id <company-id>
pnpm penclip cost by-agent --company-id <company-id>
pnpm penclip cost by-agent-model --company-id <company-id>
pnpm penclip cost by-provider --company-id <company-id>
pnpm penclip cost by-biller --company-id <company-id>
pnpm penclip cost by-project --company-id <company-id>
pnpm penclip cost window-spend --company-id <company-id>
pnpm penclip cost quota-windows --company-id <company-id>
pnpm penclip cost issue <issue-id>
pnpm penclip cost event:create --company-id <company-id> --payload-json '{...}'
```

```sh
pnpm penclip finance event:create --company-id <company-id> --payload-json '{...}'
pnpm penclip finance events --company-id <company-id>
pnpm penclip finance summary --company-id <company-id>
pnpm penclip finance by-biller --company-id <company-id>
pnpm penclip finance by-kind --company-id <company-id>
pnpm penclip budget overview --company-id <company-id>
pnpm penclip budget policy:upsert --company-id <company-id> --payload-json '{...}'
pnpm penclip budget company:update --company-id <company-id> --payload-json '{...}'
pnpm penclip budget agent:update <agent-id> --payload-json '{...}'
pnpm penclip budget incident:resolve <incident-id> --company-id <company-id> [--payload-json '{...}']
```

## Workspace And Environment Commands

```sh
pnpm penclip workspace list --company-id <company-id>
pnpm penclip workspace get <execution-workspace-id>
pnpm penclip workspace close-readiness <execution-workspace-id>
pnpm penclip workspace operations <execution-workspace-id>
pnpm penclip workspace update <execution-workspace-id> --payload-json '{...}'
pnpm penclip workspace runtime-service <execution-workspace-id> start --payload-json '{...}'
pnpm penclip workspace runtime-command <execution-workspace-id> run --payload-json '{...}'
```

```sh
pnpm penclip environment list --company-id <company-id>
pnpm penclip environment capabilities --company-id <company-id>
pnpm penclip environment create --company-id <company-id> --payload-json '{...}'
pnpm penclip environment get <environment-id>
pnpm penclip environment leases <environment-id>
pnpm penclip environment lease <lease-id>
pnpm penclip environment update <environment-id> --payload-json '{...}'
pnpm penclip environment delete <environment-id>
pnpm penclip environment probe <environment-id>
pnpm penclip environment probe-config --company-id <company-id> --payload-json '{...}'
```

```sh
pnpm penclip project-workspace list <project-id>
pnpm penclip project-workspace create <project-id> --payload-json '{...}'
pnpm penclip project-workspace update <project-id> <workspace-id> --payload-json '{...}'
pnpm penclip project-workspace delete <project-id> <workspace-id>
pnpm penclip project-workspace runtime-service <project-id> <workspace-id> restart --payload-json '{...}'
pnpm penclip project-workspace runtime-command <project-id> <workspace-id> run --payload-json '{...}'
```

## Plugin Commands

Existing plugin lifecycle commands remain available: `plugin init`, `list`, `install`, `uninstall`, `enable`, `disable`, `inspect`, and `examples`.

```sh
pnpm penclip plugin ui-contributions
pnpm penclip plugin tools
pnpm penclip plugin tool:execute --payload-json '{...}'
pnpm penclip plugin health <plugin-id>
pnpm penclip plugin logs <plugin-id>
pnpm penclip plugin upgrade <plugin-id>
pnpm penclip plugin config <plugin-id> --company-id <company-id>
pnpm penclip plugin config:set <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
pnpm penclip plugin config:test <plugin-id> --company-id <company-id> --payload-json '{"configJson":{...}}'
pnpm penclip plugin jobs <plugin-id>
pnpm penclip plugin job:runs <plugin-id> <job-id>
pnpm penclip plugin job:trigger <plugin-id> <job-id> [--payload-json '{...}']
pnpm penclip plugin webhook <plugin-id> <endpoint-key> [--payload-json '{...}']
pnpm penclip plugin dashboard <plugin-id>
pnpm penclip plugin bridge:data <plugin-id> --payload-json '{...}'
pnpm penclip plugin bridge:action <plugin-id> --payload-json '{...}'
pnpm penclip plugin bridge:stream <plugin-id> <channel> [--duration-ms 10000]
pnpm penclip plugin data <plugin-id> <key> --payload-json '{...}'
pnpm penclip plugin action <plugin-id> <key> --payload-json '{...}'
pnpm penclip plugin local-folders <plugin-id> --company-id <company-id>
pnpm penclip plugin local-folder:status <plugin-id> <folder-key> --company-id <company-id>
pnpm penclip plugin local-folder:validate <plugin-id> <folder-key> --company-id <company-id> [--payload-json '{...}']
pnpm penclip plugin local-folder:set <plugin-id> <folder-key> --company-id <company-id> --payload-json '{...}'
```

Feedback traces can be fetched directly by ID when automating export workflows:

```sh
pnpm penclip feedback trace <trace-id>
pnpm penclip feedback bundle <trace-id>
```

## Heartbeat Command

`heartbeat run` now also supports context/api-key options and uses the shared client stack:

```sh
pnpm penclip heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100] [--api-key <token>]
```

## Local Storage Defaults

Local Paperclip data lives under the selected instance root. `PAPERCLIP_HOME` chooses the home directory and `PAPERCLIP_INSTANCE_ID` chooses the instance.

```text
~/.paperclip/                                     # PAPERCLIP_HOME
└── instances/
    └── default/                                  # instance root (PAPERCLIP_INSTANCE_ID)
        ├── config.json                           # runtime config
        ├── .env                                  # instance env file
        ├── db/                                   # embedded PostgreSQL data
        ├── data/
        │   ├── storage/                          # local_disk uploads
        │   └── backups/                          # automatic DB backups
        ├── logs/
        ├── secrets/
        │   └── master.key                        # local_encrypted master key
        ├── workspaces/                           # default agent workspaces
        ├── projects/                             # project execution workspaces
        ├── companies/                            # per-company adapter homes (e.g. codex-home)
        └── codex-home/                           # per-instance codex home (when not company-scoped)
```

Default paths for the canonical install:

- config: `~/.paperclip/instances/default/config.json`
- embedded db: `~/.paperclip/instances/default/db`
- logs: `~/.paperclip/instances/default/logs`
- storage: `~/.paperclip/instances/default/data/storage`
- secrets key: `~/.paperclip/instances/default/secrets/master.key`

Override base home or instance with env vars:

```sh
PAPERCLIP_HOME=/custom/home PAPERCLIP_INSTANCE_ID=dev pnpm penclip run
```

## Storage Configuration

Configure storage provider and settings:

```sh
pnpm penclip configure --section storage
```

Supported providers:

- `local_disk` (default; local single-user installs)
- `s3` (S3-compatible object storage)
