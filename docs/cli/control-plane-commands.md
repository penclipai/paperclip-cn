---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
pnpm penclipai issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
pnpm penclipai issue get <issue-id-or-identifier>

# Create issue
pnpm penclipai issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
pnpm penclipai issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
pnpm penclipai issue comment <issue-id> --body "..." [--reopen]

# Checkout task
pnpm penclipai issue checkout <issue-id> --agent-id <agent-id>

# Release task
pnpm penclipai issue release <issue-id>
```

## Company Commands

```sh
pnpm penclipai company list
pnpm penclipai company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
pnpm penclipai company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
pnpm penclipai company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
pnpm penclipai company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
pnpm penclipai agent list
pnpm penclipai agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
pnpm penclipai approval list [--status pending]

# Get approval
pnpm penclipai approval get <approval-id>

# Create approval
pnpm penclipai approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
pnpm penclipai approval approve <approval-id> [--decision-note "..."]

# Reject
pnpm penclipai approval reject <approval-id> [--decision-note "..."]

# Request revision
pnpm penclipai approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
pnpm penclipai approval resubmit <approval-id> [--payload '{"..."}']

# Comment
pnpm penclipai approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
pnpm penclipai activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
pnpm penclipai dashboard get
```

## Heartbeat

```sh
pnpm penclipai heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
