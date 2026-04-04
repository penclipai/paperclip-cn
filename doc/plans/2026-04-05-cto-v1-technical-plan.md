# CTO V1 Technical Implementation Plan

**Date:** 2026-04-05  
**Author:** CTO Agent  
**Status:** Proposed  

## Executive Summary

Paperclip V1 is approximately **85% complete**. The core infrastructure (61 tables, 25 API routes, 72 services, 41 UI pages, 9 adapters) is substantially built. This plan addresses the **remaining 15%** — the critical gaps that block a commercial-grade V1 release.

**Target:** All 6 V1 milestones pass with green regression suite.

---

## Priority Order

### Phase 1: Critical V1 Blockers (Must Complete)

#### 1.1 Fix Onboarding / First-Run Experience (P0)
**Owner:** CTO → Engineer assignment  
**Dependency:** None  
**Risk:** HIGH — Product-critical; fresh install broken

**Problem:**
- `npx penclip onboard --yes` exists but has reported failures
- Users land on blank dashboard with no guidance
- Auth flow stability issues noted in open reports

**Deliverables:**
1. Diagnose and fix `onboard` command failures
2. Implement interview-first flow (3-4 questions):
   - Company name + goal
   - Runtime detection (available adapters)
   - CEO creation with appropriate adapter
   - First task generation
3. Auto-create starter objects: company, goal, CEO agent, first strategic task
4. Verify end-to-end: install → onboard → CEO completes first task

**Acceptance Criteria:**
- `npx penclip onboard --yes` succeeds on fresh Windows/macOS/Linux install
- User sees guided flow with sensible defaults
- After onboarding: company exists, CEO agent configured, first task created, agent can heartbeat

#### 1.2 Complete Budget Enforcement Engine (P0)
**Owner:** CTO  
**Dependency:** Schema exists, partial implementation  
**Risk:** HIGH — Core V1 promise: "at 100%, pause agent, block checkout, emit event"

**Problem:**
- `budget_policies` and `budget_incidents` tables exist
- Enforcement engine not fully wired
- Project budgets not implemented
- Approval creation on budget hard-stop incomplete
- Budget preflight checks on heartbeat dispatch paths need completion

**Deliverables:**
1. Wire budget enforcement engine in heartbeat dispatch path
2. Implement hard-stop logic: at 100% → set agent status `paused`, block checkout/invocation
3. Create approval gate when budget hard-stops (allow override)
4. Add project-level budget support
5. Implement budget preflight checks before heartbeat dispatch
6. Emit high-priority activity events on budget incidents

**Acceptance Criteria:**
- Agent at 100% budget → automatically paused
- New checkout attempts blocked with clear error
- High-priority activity event emitted
- Approval created for budget override
- Project budgets tracked separately from agent budgets

#### 1.3 V1 Regression Test Suite (P0)
**Owner:** CTO  
**Dependency:** Phase 1.1 and 1.2 complete  
**Risk:** HIGH — Cannot release without green tests

**Required Tests (per SPEC-implementation.md Section 17.4):**
1. Auth boundary test (agent keys cannot access other companies)
2. Checkout race test (atomic checkout semantics)
3. Hard budget stop test (100% → pause → block checkout)
4. Agent pause/resume test
5. Dashboard summary consistency test

**Deliverables:**
1. Write all 5 mandatory tests
2. Tests pass in CI
3. Test coverage report shows critical paths covered

**Acceptance Criteria:**
- All 5 tests pass
- No flaky tests
- Tests run in under 2 minutes total

### Phase 2: High Priority (Should Complete)

#### 2.1 Fix Checkout Conflict Logic
**Problem:** Assignees with `checkoutRunId = null` can acquire checkout by current run ID but get false 409 conflicts

**Deliverables:**
1. Fix `POST /issues/:issueId/checkout` conflict detection
2. Add test for checkout conflict edge cases

#### 2.2 Audit Schema Alignment with V1 Spec
**Problem:** 61 tables, 48 migrations — risk of drift between spec and implementation

**Deliverables:**
1. Compare actual schema to SPEC-implementation.md data model
2. Document any missing or extra columns/indexes
3. Fix any critical mismatches

#### 2.3 Verify Cost/Billing Ledger
**Problem:** Reporting queries may infer from `heartbeat_runs` instead of reading from `cost_events` ledger

**Deliverables:**
1. Verify all cost queries read from `cost_events` table
2. Verify `finance_events` table is populated correctly
3. UI shows accurate cost data from ledger

### Phase 3: Medium Priority (Nice to Have for V1)

#### 3.1 Quick Actions on List Views
- Agent list: quick action menu (Pause/Resume/Terminate)
- Approvals list: inline approve/reject buttons

#### 3.2 Enable Issue Execution Lock
- Currently behind feature flag `ISSUE_EXECUTION_LOCK_ENABLED`
- Enable and verify stable

#### 3.3 Circuit Breaker for Agents
- Per-agent circuit breaker guards
- Max consecutive failures, no-progress detection, token velocity monitoring

---

## Technical Decisions Needed

### D1: Plugin System Scope
- **Status:** Built but out of V1 scope per spec
- **Decision:** Gate behind feature flag or document as preview
- **Recommendation:** Feature flag `ENABLE_PLUGINS=false` by default

### D2: Desktop Electron Wrapper
- **Status:** Built but not in V1 spec
- **Decision:** Ship with V1 or defer
- **Recommendation:** Defer — document as experimental

### D3: Multi-User Collaboration
- **Status:** Schema exists, partial implementation
- **Decision:** Complete for V1 or defer
- **Recommendation:** Defer full invite flow — ensure single-board-operator mode is rock solid

---

## Success Criteria

V1 is done when ALL are true:

1. [ ] Onboarding: fresh install → working CEO agent in under 5 minutes
2. [ ] Budget enforcement: hard-stop works, approval gate created
3. [ ] All 5 mandatory regression tests pass
4. [ ] All 8 V1 UI routes functional with no critical bugs
5. [ ] Schema matches V1 spec
6. [ ] Cost reporting reads from ledger
7. [ ] `pnpm build` succeeds with no errors
8. [ ] `pnpm test:run` passes

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Onboarding fix is complex | Start with diagnostic test run, then incremental fix |
| Budget enforcement touches many paths | Write tests first, then implement, then verify |
| Schema drift found late | Audit early in Phase 1 |
| Test flakiness | Write deterministic tests, avoid race conditions |

---

## Next Steps

1. **Immediate:** Create diagnostic script for onboarding failures
2. **Today:** Start budget enforcement wiring
3. **This week:** Complete Phase 1 blockers
4. **Next week:** Phase 2 verification and fixes
5. **Release candidate:** All tests green, build passes, manual QA sign-off
