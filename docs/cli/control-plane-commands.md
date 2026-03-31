---
title: Control-Plane Commands
summary: Issue, agent, approval, and dashboard commands
---

Client-side commands for managing issues, agents, approvals, and more.

## Issue Commands

```sh
# List issues
penclip issue list [--status todo,in_progress] [--assignee-agent-id <id>] [--match text]

# Get issue details
penclip issue get <issue-id-or-identifier>

# Create issue
penclip issue create --title "..." [--description "..."] [--status todo] [--priority high]

# Update issue
penclip issue update <issue-id> [--status in_progress] [--comment "..."]

# Add comment
penclip issue comment <issue-id> --body "..." [--reopen]

# Checkout task
penclip issue checkout <issue-id> --agent-id <agent-id>

# Release task
penclip issue release <issue-id>
```

## Company Commands

```sh
penclip company list
penclip company get <company-id>

# Export to portable folder package (writes manifest + markdown files)
penclip company export <company-id> --out ./exports/acme --include company,agents

# Preview import (no writes)
penclip company import \
  <owner>/<repo>/<path> \
  --target existing \
  --company-id <company-id> \
  --ref main \
  --collision rename \
  --dry-run

# Apply import
penclip company import \
  ./exports/acme \
  --target new \
  --new-company-name "Acme Imported" \
  --include company,agents
```

## Agent Commands

```sh
penclip agent list
penclip agent get <agent-id>
```

## Approval Commands

```sh
# List approvals
penclip approval list [--status pending]

# Get approval
penclip approval get <approval-id>

# Create approval
penclip approval create --type hire_agent --payload '{"name":"..."}' [--issue-ids <id1,id2>]

# Approve
penclip approval approve <approval-id> [--decision-note "..."]

# Reject
penclip approval reject <approval-id> [--decision-note "..."]

# Request revision
penclip approval request-revision <approval-id> [--decision-note "..."]

# Resubmit
penclip approval resubmit <approval-id> [--payload '{"..."}']

# Comment
penclip approval comment <approval-id> --body "..."
```

## Activity Commands

```sh
penclip activity list [--agent-id <id>] [--entity-type issue] [--entity-id <id>]
```

## Dashboard

```sh
penclip dashboard get
```

## Heartbeat

```sh
penclip heartbeat run --agent-id <agent-id> [--api-base http://localhost:3100]
```
