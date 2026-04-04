# Onboarding First-Run Experience Fix Plan

**Date:** 2026-04-05
**Status:** In Progress

## Problem

`npx penclip onboard --yes` exists but has reported failures:
- Users land on blank dashboard with no guidance
- No automatic CEO agent creation in CLI flow
- No first task generation
- Auth flow stability issues

## Root Cause Analysis

The current `onboard` command:
1. ✅ Creates config file
2. ✅ Sets up database, storage, secrets
3. ✅ Generates JWT secrets
4. ⚠️ **Does NOT create company, CEO agent, or first task**
5. ⚠️ Bootstrap CEO invite only works in `authenticated` mode with external DB

The UI OnboardingWizard handles company/CEO/task creation, but:
- Requires browser interaction
- Not available in CLI `--yes` automated flow
- Fresh install users expect `penclip onboard --yes && penclip run` to work

## Solution

### Phase 1: CLI Onboarding Enhancement

Enhance `cli/src/commands/onboard.ts` to support `--yes` mode that:

1. **After config creation**, if `--yes` flag:
   - Create default company via API
   - Create root company goal
   - Detect available adapters (check env vars for API keys)
   - Create CEO agent with best available adapter
   - Create first strategic task assigned to CEO
   - Output summary with next steps

2. **Adapter Detection Logic** (priority order):
   - `claude_local` if `ANTHROPIC_API_KEY` set
   - `codex_local` if `OPENAI_API_KEY` set
   - `qwen_local` if `DASHSCOPE_API_KEY` set
   - `gemini_local` if `GEMINI_API_KEY` set
   - `process` adapter as fallback (requires no API key)

3. **Company Creation**:
   - Name: from env `PAPERCLIP_COMPANY_NAME` or "My AI Company"
   - Auto-generate unique issue prefix
   - Status: active

4. **CEO Agent Creation**:
   - Name: "CEO"
   - Role: "ceo"
   - Adapter: best available from detection
   - Status: active

5. **First Task**:
   - Title: "Define company mission and initial strategy"
   - Description: CEO onboarding prompt
   - Status: todo
   - Assigned to: CEO agent

### Phase 2: Verification

1. Update CLI onboard tests to verify auto-creation
2. Test `penclip onboard --yes` end-to-end
3. Verify server starts with company/CEO/task ready
4. Verify CEO agent can heartbeat and execute task

## Acceptance Criteria

- [ ] `penclip onboard --yes` succeeds on fresh install
- [ ] Creates company with default name
- [ ] Creates CEO agent with detected adapter
- [ ] Creates first task assigned to CEO
- [ ] Server starts and shows dashboard with data
- [ ] CEO agent can heartbeat (if adapter configured)
- [ ] All tests pass

## Implementation Order

1. Add company/CEO/task creation to onboard.ts
2. Add adapter detection helper
3. Add tests for new flow
4. Manual verification
5. Update CTO V1 plan checklist
