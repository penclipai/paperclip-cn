# UI Localization Policy

Use this reference for zh-CN architecture, content ownership, terminology, key design, wording, formatting, and localization regression policy. Use [browser-i18n-audit.md](browser-i18n-audit.md) for rendered route and interaction coverage.

## Contents

1. Goals and architecture
2. Locale detection and switching
3. Content ownership
4. Brand and command boundaries
5. Terminology
6. Key design and catalog maintenance
7. Implementation workflow
8. Wording and formatting
9. Regression and upstream sync

## Goals And Architecture

Paperclip CN localization must:

- provide a zh-CN-first experience with English switching
- minimize conflict when absorbing upstream structure
- keep visible branding separate from technical contracts
- centralize repeated labels and generated phrases
- extend incrementally without whole-component rewrites

### Frontend

The frontend uses `react-i18next`, `i18next`, `i18next-http-backend`, and `i18next-browser-languagedetector`.

Current contract:

- supported locales: `zh-CN` and `en`
- `DEFAULT_UI_LOCALE`: `zh-CN`
- `fallbackLng`: `zh-CN`
- editable catalog source: `ui/locales-src/`
- generated runtime resources: `ui/public/locales/zh-CN/common.json` and `ui/public/locales/en/common.json`
- main entrypoints: `ui/src/i18n.ts` and `ui/src/main.tsx`
- paired source entries are the authority for application-owned visible strings;
  runtime JSON is generated from them
- translation resources stay out of component-local TypeScript objects

English is a supported selected language, not the fallback locale.

### Backend And Runtime

The server owns localization for application-generated human-readable errors and runtime guidance:

- UI requests send `Accept-Language`
- localized responses set `Content-Language`
- language-varying responses include `Vary: Accept-Language`
- first-page HTML receives locale and locale-source attributes
- user-visible errors pass through server localization
- runtime prompts, handoffs, remediation, onboarding snippets, and generated operator text are audited localization surfaces

Keep adapter implementations generic. Add shared runtime localization at server or shared helper boundaries instead of duplicating similar prompt fragments in each adapter.

## Locale Detection And Switching

Use this first-page precedence:

1. explicit query parameter such as `?lng=`
2. saved user choice in localStorage
3. server-selected `html lang` from request language
4. browser `navigator.language` when the page locale source permits it
5. `DEFAULT_UI_LOCALE`

Unsupported query, storage, header, or browser values must be ignored so detection can continue. Do not normalize every unknown value directly to zh-CN at the first detector.

The server injects `lang` and `data-ui-locale-source`. When the source is the request, `htmlTag` must be considered before navigator language.

Language switching must:

- update `html lang`
- preserve the user's saved choice across refreshes
- rerender through i18n without remounting the entire React tree
- preserve dialog state, wizard steps, and user-entered drafts

If default draft text changes with locale, update it only while the user has not edited it. Compare against a snapshot of the previous default instead of reading a ref that an asynchronous state update can race with.

## Content Ownership

Classify text before translating it. English characters alone do not prove a defect.

### Translate

- page titles, navigation, buttons, menus, tabs, dialogs, and empty states
- placeholders, tooltips, aria labels, accessible names, and toasts
- application-maintained status, priority, policy, trigger, runtime, and entity labels
- validation, remediation, warning, banner, system notice, and activity phrases
- application-owned onboarding, import/export, invite, help, and operator guidance
- server errors displayed directly to users
- plugin descriptions and host UI around raw plugin identifiers

### Preserve Raw

- user-authored names, titles, descriptions, comments, and model output
- package names, adapter IDs/types, provider/model names, and plugin names
- protocol fields, gateway events, logs, stdout, and stderr
- environment variables, API fields, localStorage keys, paths, URLs, and command-line arguments
- issue, run, company, and other serialized identifiers
- source code and historical literal quotations where fidelity matters

Mixed UI can contain a translated label followed by a raw user name or technical identifier. Classify each fragment independently.

For audit/activity rows and plugin actions, map known application-owned event
codes to localized action templates in the shared presentation helper. Preserve
the stored event ID and interpolate raw package names and entity identifiers.
An unknown event or third-party payload stays inspectable through the existing
raw fallback; do not translate arbitrary identifiers by splitting or replacing
their English words. Cover known templates, unknown fallback, and language
switching when changing the shared mapping.

### Controlled Seeded Names

Known repository seed names may use `ui/src/lib/seeded-display.ts` and `displaySeededName()` for presentation mapping while the stored value remains stable.

Rules:

- use controlled mapping only on surfaces intended to present known seed values
- do not rewrite persisted names during localization
- do not create a global string replacement for common English words
- preserve user-edited values on surfaces that do not opt into the controlled mapping contract
- do not claim provenance-based behavior unless the caller has actual seed metadata

`displaySeededName()` currently receives only the name and maps exact configured strings; it cannot distinguish a repository seed from user-authored data with the same value. `CEO` remains raw by terminology policy. A surface that opts into the helper may present exact names such as `Onboarding` through their seeded translation key while keeping the stored value unchanged. A surface that must preserve arbitrary user names must not apply the helper without provenance or a narrower product contract.

## Brand And Command Boundaries

Visible product copy may use:

- `Paperclip CN`
- `penclip`
- `penclip.ing`
- `paperclipai.cn`

Preserve technical contracts:

- repository name `paperclip-cn`
- public npm and workspace package names such as `@penclipai/*`
- CLI package and executable `penclip`
- `PAPERCLIP_*` environment variables
- internal paths, API shapes, database fields, and compatibility keys

Choose command form by audience:

- public installation, onboarding, operator snippets, generated help, and CLI remediation use `penclip` or `npx penclip` as documented
- repository development, maintenance, scripts, and worktree instructions normally retain `pnpm penclip`
- logs, historical output, and literal quotations preserve their original command text

Do not perform repository-wide mechanical replacements between `pnpm penclip`, `penclip`, and `npx penclip`.

### Data Path Boundaries

Visible brand does not determine storage paths:

- Electron default user data directory uses the no-space slug `penclip` under the operating-system app-data root
- CLI and server default home remains `~/.paperclip`
- repo-local `.paperclip/`, `PAPERCLIP_HOME`, and `PAPERCLIP_CONTEXT` remain technical identifiers

Do not merge desktop user-data policy with CLI/server home policy during rebrand work.

## Terminology

Use these default translations consistently:

| English | zh-CN |
|---|---|
| Agent | 智能体 |
| Issue | 任务 |
| Routine | 例行任务 |
| Run | 运行 |
| Workspace | 工作区 |
| Project | 项目 |
| Goal | 目标 |
| Inbox | 收件箱 |
| Dashboard | 仪表盘 |
| Approvals | 审批 |
| Costs | 成本 |
| Org | 组织 |
| Skills | 技能 |
| Instance | 实例 |
| Heartbeats | 心跳 |
| token as usage unit | 词元 |
| token as credential | 令牌 |

Context can refine verbs:

- `Create`: 创建 or 新建
- `Open`: 打开 or 查看
- `Review`: 查看 or 审核
- `Budget`: 预算

Prefer concise, action-oriented Chinese. Avoid mixed Chinese/English product jargon when the English fragment is application-owned copy.

## Key Design And Catalog Maintenance

Prefer stable semantic keys for:

- navigation and shared shells
- repeated buttons and actions
- tabs, filters, status, priority, and policy labels
- interpolated or pluralized phrases
- brand copy, import/export guidance, and backend errors

Controlled source-text keys are acceptable only for low-reuse leaf copy, high-churn upstream text, or migration staging. Promote them to semantic keys when they become shared, interpolated, or reused.

Maintain these invariants:

- add or update `en` and `zh-CN` together in one paired source entry
- define a key once across all source files; implicit overrides are forbidden
- use shared enum and formatting helpers instead of component-local maps
- keep dynamic key prefixes discoverable and covered by tests or explicit audit notes
- never delete a key from static `unusedKeys` evidence alone

The editable source layout controls file ownership, without changing the flat
runtime key contract:

- semantic-shaped keys are stored in
  `ui/locales-src/semantic/domain-<first-prefix-lowercase>.json`
- controlled source-text keys are stored in
  `ui/locales-src/source-text/<first-ascii-letter-lowercase-or-other>.json`
- every value is an object with `en`, `zh-CN`, and `reviewedEnglishHash`

`reviewedEnglishHash` is the SHA-256 hash of the exact English string bytes.
It must match before generation or read-only checks pass. Changing English
requires an explicit per-key review; it does not imply that Chinese must change.
The `i18n:review` command updates only selected review metadata and never
translates copy. Runtime catalogs are sorted with ordinal comparison, UTF-8,
LF, and a final newline. Do not manually edit generated `common.json` files.

After reviewing a changed English value, acknowledge only the intended key:

```sh
pnpm i18n:review -- --key <exact-key>
pnpm i18n:build
pnpm check:i18n
```

A Chinese value may remain unchanged after that review. Do not bulk-refresh
review hashes merely to make a sync pass.

`scheduleDescription.dayOfMonthOrdinal` is the only placeholder-set exception:
English uses `ordinal`, zh-CN uses `count`, and callers provide both. All other
paired strings must expose the same placeholders.

## Implementation Workflow

For new or changed UI:

1. Classify the content owner.
2. Reuse an existing key, enum helper, seeded-name helper, or formatter.
3. Add or update the paired source entry in its required owner file.
4. Use `useTranslation()` or the established non-React translation helper.
5. Keep user data and technical values outside translated templates.
6. Route dates, times, relative time, numbers, currency, and token counts through locale-aware helpers.
7. Localize server warnings and event codes through controlled mappings instead of displaying raw application-owned English.
8. Add focused tests for shared helpers, generated phrases, or reusable components.
9. Run `pnpm i18n:build` and `pnpm check:i18n`, then recheck the rendered
   interaction in the browser.

English fallback can be used while absorbing upstream changes, but it is migration state. Before PR delivery, review every affected visible surface and fix application-owned high-visibility fallback. Record user data and technical text as intentionally raw.

## Wording And Formatting

### Chinese Style

- write short sentences focused on the next action
- use familiar Chinese product language
- avoid literal translation that preserves awkward English grammar
- keep labels short enough for compact controls
- preserve interpolation and plural semantics rather than concatenating fragments

### Currency

- use the shared currency formatter and parser
- do not concatenate `$` or hardcode currency labels in components
- localization changes display format, not stored currency semantics
- do not introduce conversion rates or automatic USD/CNY conversion without a product contract

### Dates, Numbers, And Tokens

- do not hardcode `en-US` or call bare `toLocaleString()` in pages
- use locale-aware date, time, relative-time, and number helpers
- translate usage units as `词元`
- preserve credential token semantics as `令牌`

## Regression And Upstream Sync

For locale changes, run:

```sh
pnpm i18n:build
pnpm check:i18n
pnpm exec vitest run ui/src/lib/locale-catalog.test.ts ui/src/i18n/locale-validation.test.ts
node .agents/skills/paperclip-cn-fork-maintenance/scripts/i18n-key-audit.mjs snapshot --out .omx/i18n-key-audit/current.json
```

Treat snapshot findings correctly:

- duplicate keys and locale parity gaps are blockers
- likely zh-CN English fallback requires review
- dynamic call warnings require prefix and runtime-source review
- static unused keys are cleanup candidates, not deletion authority

The audit snapshot schema is v2 and records
`undefinedStaticTranslationCallFindings` separately. A comparison against a
retained v1 baseline reports
`undefinedStaticTranslationCallBaselineUnavailable`; it does not treat the old
baseline as zero findings. Capture a fresh v2 baseline before the next upstream
sync, then treat new or regressed undefined static calls as blockers.

Use impact browser audit for ordinary changes and full browser audit only when requested. Record routes, dynamic entities, interactions, findings, and unreachable surfaces as described in [browser-i18n-audit.md](browser-i18n-audit.md).

During upstream sync:

- accept upstream component and page structure first
- preserve locale entrypoints, catalogs, language switching, server headers, and error localization as narrow patches
- capture pre/post key snapshots when the pre-merge stage is still available
- update `ui/locales-src/`, never generated catalogs, then rebuild and check the
  generated runtime resources
- report missing real static keys, changed English values awaiting review, and
  dynamic-prefix leads; static unused keys and duplicate-English candidates are
  review leads only
- explicitly review changed English values before PR delivery
- inspect every merge-touched visible surface before PR delivery
- never retain an entire old component solely to preserve translated copy
