# Browser i18n Audit

Use this reference to inspect rendered zh-CN behavior across pages, subpages, dialogs, menus, and transient UI.

## Contents

1. Audit modes
2. Route inventory
3. Content classification
4. Interaction matrix
5. Finding workflow
6. Evidence and acceptance

## Audit Modes

Choose the mode from the request:

| Mode | Coverage |
|---|---|
| impact audit | routes, shared components, and interactions affected by the current diff |
| full browser audit | every reachable production route plus representative dynamic detail routes and interactions |

An upstream sync defaults to impact audit unless the user requests every page, dialog, or subpage. A full audit is not complete after checking only sidebar destinations.

## Route Inventory

Before browser review, generate a read-only source inventory:

```sh
pnpm audit:i18n-visible -- --out .omx/i18n-browser-audit/visible-before.json
```

The scanner records JSX text, visible attributes, visible conditional/template
branches and label/title/description configuration. Tests, stories, labs, design
and performance fixtures are excluded. Implementation-only branches are recorded
separately as `uncertainCandidates`. Candidate counts are review leads, not a
translation completeness gate: labels may be translated at their consumer, and
user-authored or third-party data must stay raw. The scanner's recognition of
`t`/`translateInstant` is intentionally narrower than the binding-aware key audit.
Review both inventories and rendered states; do not rewrite every Latin string.

Use `pnpm test:i18n` for scanner/catalog regression checks and
`pnpm test:e2e:i18n` for the isolated production-board language-switch smoke.
The latter creates its own temporary instance through the existing E2E config;
it must not attach to a developer's active database. Its narrow assertions do
not prove full route or dialog coverage.

Derive the route inventory from `ui/src/App.tsx` at audit time.

Include:

- production board routes reachable under the active company prefix
- global production routes such as authentication, onboarding, invites, and claims when test data permits
- nested settings pages and plugin/adapter detail routes
- representative dynamic entity pages for issues, agents, projects, routines, workspaces, goals, approvals, cases, pipelines, artifacts, and users
- shared navigation, sidebars, command/search surfaces, and company switching

Exclude redirect-only aliases after confirming their destination. Exclude performance fixtures, UX labs, design-guide pages, and development-only routes unless the request or touched diff includes them.

For a dynamic route, record the representative entity used. Do not claim coverage for an entity type that could not be opened.

## Content Classification

Classify each English-looking string before changing code.

| Content class | Default treatment | Examples |
|---|---|---|
| application chrome | translate | headings, buttons, tabs, field labels, menu actions |
| system enum or generated state | translate through shared helpers or locale keys | status, priority, policy, trigger, runtime state |
| application-owned validation or notice | translate | errors, warnings, empty states, remediation, activity phrases |
| user-authored entity data | preserve verbatim | agent names, project names, issue titles, comments |
| controlled repository seed value | localize only through `displaySeededName()` on an intended presentation surface; preserve storage | known seeded role or project names covered by the helper |
| technical identifier | preserve verbatim | package, adapter type, provider, model, env var, API field |
| command, path, URL, log, or protocol payload | preserve or normalize by documented audience policy | CLI snippets, stdout, gateway events |
| third-party product name | normally preserve | provider and integration brand names |

English characters alone do not prove a localization defect. Mixed content can contain a translated label followed by a raw entity name or identifier.

`displaySeededName()` currently maps exact strings and receives no provenance metadata. Treat its use as an opt-in presentation policy for a known surface, not proof that a value came from repository seeding. If provenance is unknown, trace the owning component and preserve user-authored data unless that surface intentionally applies the controlled mapping.

## Interaction Matrix

For every audited route, inspect applicable surfaces rather than mechanically opening unavailable controls.

### Page shell

- document and page title
- breadcrumbs and back links
- sidebar and local navigation
- primary and secondary actions
- section headings, metrics, badges, and metadata labels
- table headers, filters, sort controls, pagination, and bulk actions

### Data states

- populated state
- loading or skeleton state when reproducible
- empty state
- validation and permission errors
- disconnected, retry, paused, archived, interrupted, or unavailable states when the route supports them

### Interactive surfaces

- tabs and nested tabs
- dropdowns, context menus, command menus, and selectors
- create, edit, confirm, destructive, and settings dialogs
- drawers, side panels, property inspectors, and relationship panels
- tooltips, icon accessible names, aria labels, and placeholders
- toast, banner, inline notice, and system-generated activity text
- expandable run, event, transcript, artifact, and comment sections

### Responsive and overflow check

Check that translated text fits its container at the available viewport. Flag clipping, overlap, inaccessible actions, and controls whose dimensions shift incoherently after translation.

## Finding Workflow

For every suspected missing translation:

1. Record route, interaction, visible text, and content classification.
2. Identify the owning component and data source.
3. Determine whether an existing shared translation helper or locale key applies.
4. Add or update both `en` and `zh-CN` catalogs when a new key is needed.
5. Keep dynamic user data and technical identifiers outside translated templates.
6. Avoid hardcoded Chinese in components.
7. Add focused coverage for shared enum helpers, generated phrases, or reusable components when the regression can recur.
8. Reopen the same interaction after the fix and verify the rendered result.

When a browser comment highlights a mixed block, review each text fragment independently. The selected container is evidence of where the user noticed the issue, not proof that every child string should be translated.

## Evidence Record

Keep local evidence under `.omx/i18n-browser-audit/` and do not commit it. Use JSON or Markdown with these fields:

```text
mode:
locale:
base_url:
routes_reviewed:
dynamic_entities_used:
interactions_reviewed:
findings:
unreachable_surfaces:
verification_after_fixes:
```

For each finding record:

- route and interaction
- observed text
- classification
- owning file or component
- locale key or helper used by the fix
- post-fix status

## Acceptance

An impact audit passes when every affected route and shared interaction has been reviewed, all actionable findings are fixed or blocked precisely, locale parity remains valid, and affected browser interactions are rechecked.

A full audit passes when:

- all reachable production routes in the generated inventory have a recorded result
- representative dynamic detail routes were opened
- applicable dialogs, menus, tabs, tooltips, toasts, empty states, and error states were exercised
- user data and technical identifiers were not incorrectly translated
- actionable findings were traced to locale-backed implementations
- unreachable or data-dependent surfaces are listed as residual coverage, not silently marked complete

After fixes, run locale catalog tests, the i18n key audit, UI typecheck, relevant component tests, and `pnpm check:token-gates` for UI changes.
