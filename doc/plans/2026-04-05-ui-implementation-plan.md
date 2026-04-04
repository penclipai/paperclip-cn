# Phased UI Implementation Plan: V1 Completion

**Date**: 2026-04-05  
**Author**: UXDesigner (dd090667-82f2-4dcb-942f-4cca9ebed2ec)  
**Task**: PEN-2 - UI Audit: Assess current Board UI state and create design plan for V1 completion  
**Source**: UI Audit Report (doc/plans/2026-04-05-ui-audit.md)

## Overview

This plan outlines the phased approach to complete the Paperclip CN Board UI for V1 release. The plan addresses all gaps identified in the UI audit report and prioritizes work based on V1 spec requirements and operator impact.

### Current State: 75% V1 Complete
### Target State: 100% V1 Compliant

---

## Phase 1: Critical V1 Blockers (Week 1-2)

**Goal**: Address all V1 spec blockers  
**Estimated Effort**: 8-12 days  
**Priority**: 🔴 Critical

### 1.1 Integrate Kanban View into Issues Page

**Why**: V1 spec requires "task list/kanban" view; component exists but not wired up  
**Impact**: High - Essential for task management workflows  
**Effort**: 2-3 days

**Tasks**:
- [ ] Add tab switcher to Issues page (List / Kanban)
- [ ] Wire `KanbanBoard.tsx` to issues API data
- [ ] Sync state between List and Kanban views
- [ ] Add drag-and-drop status changes
- [ ] Test with large issue sets (50+ issues)

**Files to Modify**:
- `ui/src/pages/Issues.tsx`
- `ui/src/components/KanbanBoard.tsx` (verify API integration)

**Acceptance Criteria**:
- ✅ Users can switch between List and Kanban views
- ✅ Dragging cards changes issue status
- ✅ Both views show same data
- ✅ Performance acceptable with 50+ issues

---

### 1.2 Implement Conflict Toast System

**Why**: V1 spec explicitly requires "conflict toasts on atomic checkout failure"  
**Impact**: High - Critical for concurrent operator scenarios  
**Effort**: 1-2 days

**Tasks**:
- [ ] Create `ConflictToast.tsx` component
- [ ] Hook into checkout API error responses (409 Conflict)
- [ ] Display toast with conflict details in `IssueDetail.tsx`
- [ ] Add "Refresh" action to resolve conflict
- [ ] Test with concurrent checkout attempts

**Files to Create**:
- `ui/src/components/ConflictToast.tsx`

**Files to Modify**:
- `ui/src/pages/IssueDetail.tsx`
- `ui/src/api/issues.ts` (error handling)

**Acceptance Criteria**:
- ✅ Toast appears on 409 Conflict response
- ✅ Shows conflicting user and timestamp
- ✅ Provides "Refresh" button to reload issue state
- ✅ Toast auto-dismisses after 10 seconds or manual close

---

### 1.3 Add Failed Run Visibility

**Why**: V1 spec requires "every failed run visible in UI"  
**Impact**: High - Operator must see failures immediately  
**Effort**: 2-3 days

**Tasks**:
- [ ] Create `FailedRunIndicator.tsx` component
- [ ] Add failed runs section to Dashboard
- [ ] Query heartbeat API for failed/completed-with-error runs
- [ ] Display run details: agent, issue, error, timestamp
- [ ] Add click-through to run transcript
- [ ] Consider dedicated `/failed-runs` page for history

**Files to Create**:
- `ui/src/components/FailedRunIndicator.tsx`

**Files to Modify**:
- `ui/src/pages/Dashboard.tsx`
- `ui/src/api/heartbeats.ts` (add failed runs query)

**Acceptance Criteria**:
- ✅ Failed runs visible on Dashboard
- ✅ Shows agent name, issue, error summary, time ago
- ✅ Click navigates to run transcript
- ✅ No silent failures - all errors surfaced

---

### 1.4 Add Quick Actions to List Views

**Why**: V1 spec requires "quick actions: pause/resume agent, create task, approve/reject request"  
**Impact**: High - Operator efficiency  
**Effort**: 3-4 days

**Tasks**:

#### 1.4.1 Agent List Quick Actions
- [ ] Add action menu to each agent in `/agents` list
- [ ] Actions: Pause, Resume, Terminate, View Details
- [ ] Confirm destructive actions (terminate)
- [ ] Update agent status in UI optimistically

#### 1.4.2 Issues List Quick Actions
- [ ] Add "New Task" button to Issues page header
- [ ] Add status change menu to each issue (if permissions allow)
- [ ] Add assignee change dropdown
- [ ] Open `NewIssueDialog` on create

#### 1.4.3 Approvals List Quick Actions
- [ ] Add approve/reject buttons to each approval card
- [ ] Show confirmation dialog before action
- [ ] Add optional comment field
- [ ] Update list on action completion

**Files to Modify**:
- `ui/src/pages/Agents.tsx`
- `ui/src/pages/Issues.tsx`
- `ui/src/pages/Approvals.tsx`
- `ui/src/components/IssuesList.tsx`
- `ui/src/components/ApprovalCard.tsx`

**Acceptance Criteria**:
- ✅ All list views have quick actions
- ✅ Actions update data without page reload
- ✅ Destructive actions require confirmation
- ✅ Errors displayed clearly

---

## Phase 2: Medium Priority Improvements (Week 3)

**Goal**: Enhance operator efficiency and completeness  
**Estimated Effort**: 7-10 days  
**Priority**: 🟡 Medium

### 2.1 Budget Editing UI

**Why**: Budgets displayed but not editable; operators need to manage budgets  
**Impact**: Medium - Budget management is core V1 feature  
**Effort**: 2-3 days

**Tasks**:
- [ ] Add "Edit Budget" button to Costs page
- [ ] Create `BudgetEditDialog.tsx`
- [ ] Fields: monthly budget (cents), alert threshold, hard limit
- [ ] Validate inputs (non-negative, alert < hard limit)
- [ ] Update company budget via API
- [ ] Show success/error toasts

**Files to Create**:
- `ui/src/components/BudgetEditDialog.tsx`

**Files to Modify**:
- `ui/src/pages/Costs.tsx`
- `ui/src/api/companies.ts` (add budget update method)

**Acceptance Criteria**:
- ✅ Can edit company budget from Costs page
- ✅ Validation prevents invalid inputs
- ✅ Budget updates reflected immediately
- ✅ Errors handled gracefully

---

### 2.2 Bulk Operations

**Why**: Operators need to perform batch actions efficiently  
**Impact**: Medium - Improves workflow speed  
**Effort**: 3-4 days

**Tasks**:

#### 2.2.1 Checkbox Selection
- [ ] Add checkboxes to Issues list
- [ ] Add checkboxes to Agents list
- [ ] Add "Select All" toggle
- [ ] Track selected items in state

#### 2.2.2 Bulk Action Bar
- [ ] Create `BulkActionBar.tsx` component
- [ ] Show when items selected
- [ ] Actions for issues: Change Status, Assign, Delete
- [ ] Actions for agents: Pause, Resume, Terminate
- [ ] Confirm bulk destructive actions

**Files to Create**:
- `ui/src/components/BulkActionBar.tsx`

**Files to Modify**:
- `ui/src/components/IssuesList.tsx`
- `ui/src/pages/Agents.tsx`

**Acceptance Criteria**:
- ✅ Can select multiple items
- ✅ Bulk actions apply to all selected
- ✅ Confirmation for destructive actions
- ✅ Progress indicator during bulk operations

---

### 2.3 Real-time Activity Updates

**Why**: Activity page requires manual refresh; operators need live visibility  
**Impact**: Medium - Improves monitoring experience  
**Effort**: 2-3 days

**Tasks**:
- [ ] Add polling to Activity page (30s interval)
- [ ] Auto-append new activities to top
- [ ] Animate new entries (similar to Dashboard)
- [ ] Add "Pause Auto-Refresh" toggle
- [ ] Consider WebSocket for push updates (stretch goal)

**Files to Modify**:
- `ui/src/pages/Activity.tsx`
- `ui/src/api/activity.ts`

**Acceptance Criteria**:
- ✅ Activity feed updates automatically
- ✅ New entries animated in
- ✅ Can pause auto-refresh
- ✅ No performance degradation with large datasets

---

## Phase 3: Polish & Optimization (Week 4)

**Goal**: Improve UX quality of life and performance  
**Estimated Effort**: 5-7 days  
**Priority**: 🟢 Low (Nice-to-Have)

### 3.1 Mobile Responsiveness Audit

**Why**: Some pages not fully optimized for mobile  
**Impact**: Low-Medium - Affects mobile operators  
**Effort**: 2-3 days

**Tasks**:
- [ ] Test all pages on mobile viewports (375px width)
- [ ] Fix overflow issues in tables and lists
- [ ] Ensure touch targets are 44px minimum
- [ ] Test mobile navigation (bottom nav already exists)
- [ ] Optimize forms for mobile input

**Files to Modify**: (TBD after audit)

**Acceptance Criteria**:
- ✅ All pages usable on 375px width
- ✅ No horizontal scrolling
- ✅ Touch targets meet accessibility guidelines
- ✅ Mobile navigation intuitive

---

### 3.2 Activity Export

**Why**: Audit compliance and offline review  
**Impact**: Low - Compliance requirement  
**Effort**: 1-2 days

**Tasks**:
- [ ] Add "Export" button to Activity page
- [ ] Export formats: CSV, JSON
- [ ] Date range picker for filtering
- [ ] Download file with timestamp in name
- [ ] Show export progress

**Files to Modify**:
- `ui/src/pages/Activity.tsx`
- `ui/src/api/activity.ts` (add export endpoint)

**Acceptance Criteria**:
- ✅ Can export activity log as CSV/JSON
- ✅ Date range filtering works
- ✅ File downloads with proper name
- ✅ Export handles large datasets (1000+ entries)

---

### 3.3 Performance Optimization

**Why**: Ensure V1 meets latency targets (p95 < 250ms)  
**Impact**: Low-Medium - User experience quality  
**Effort**: 2-3 days

**Tasks**:
- [ ] Audit page load times with React DevTools
- [ ] Implement virtualization for long lists (Issues, Activity)
- [ ] Lazy load heavy components (charts, org chart)
- [ ] Optimize bundle size (code splitting)
- [ ] Add skeleton loaders for all pages

**Files to Modify**:
- `ui/src/components/IssuesList.tsx` (virtualization)
- `ui/src/pages/Activity.tsx` (virtualization)
- `ui/src/components/OrgChart.tsx` (lazy load)
- `vite.config.ts` (code splitting)

**Acceptance Criteria**:
- ✅ Initial page load < 2s on 3G
- ✅ List scrolling smooth with 500+ items
- ✅ No layout shift during data loading
- ✅ Bundle size < 500KB gzipped

---

## Testing Strategy

### Unit Tests
- [ ] Test KanbanBoard drag-and-drop logic
- [ ] Test ConflictToast rendering
- [ ] Test FailedRunIndicator data fetching
- [ ] Test BulkActionBar action handlers

### Integration Tests
- [ ] Test Issues page with both List and Kanban views
- [ ] Test quick actions updating data correctly
- [ ] Test budget edit dialog API integration
- [ ] Test activity polling with new entries

### Manual QA
- [ ] Test all quick actions on staging
- [ ] Verify conflict toast with concurrent users
- [ ] Test failed run visibility with error scenarios
- [ ] Mobile testing on iOS and Android

---

## Success Metrics

### V1 Compliance
- ✅ 100% of V1 UI requirements met
- ✅ All spec-required UX behaviors implemented
- ✅ Zero critical gaps remaining

### Operator Experience
- ✅ < 3 clicks for common actions (pause, create, approve)
- ✅ Failed runs visible within 5 seconds of occurrence
- ✅ No silent failures in UI

### Performance
- ✅ Page load < 2s on 3G
- ✅ List rendering < 100ms for 100 items
- ✅ No jank during interactions (60fps)

---

## Risk Management

### Risk 1: API Limitations
**Risk**: Backend APIs don't support required UI features (e.g., bulk operations)  
**Mitigation**: Coordinate with backend team; add API endpoints as needed  
**Impact**: Medium

### Risk 2: Performance Degradation
**Risk**: New features slow down page performance  
**Mitigation**: Profile after each feature; add virtualization early  
**Impact**: Medium

### Risk 3: Scope Creep
**Risk**: Phase 3 features expand beyond timeline  
**Mitigation**: Strictly prioritize Phase 1; defer non-critical work  
**Impact**: Low

---

## Dependencies

### Backend Dependencies
- Heartbeat API: failed runs query (Phase 1.3)
- Issues API: bulk update endpoint (Phase 2.2)
- Companies API: budget update endpoint (Phase 2.1)

### Design Dependencies
- Component designs follow existing Design Guide patterns
- No new visual design required (reuse existing system)

### Testing Dependencies
- Test data with various states (failed runs, conflicts, etc.)
- Staging environment for integration testing

---

## Rollout Plan

### Week 1-2: Phase 1
- Deploy Kanban integration
- Deploy conflict toasts
- Deploy failed run indicator
- Deploy quick actions
- **Milestone**: V1 spec compliant

### Week 3: Phase 2
- Deploy budget editing
- Deploy bulk operations
- Deploy real-time activity
- **Milestone**: Operator efficiency improved

### Week 4: Phase 3
- Deploy mobile fixes
- Deploy activity export
- Deploy performance optimizations
- **Milestone**: Production-ready quality

---

## Conclusion

This phased plan addresses all V1 UI gaps identified in the audit report while maintaining flexibility for post-V1 improvements. Phase 1 is **non-negotiable for V1 compliance** and should be prioritized above all else.

Phases 2 and 3 can be adjusted based on timeline constraints, but Phase 1 must be completed before V1 release.

### Next Steps
1. ✅ Complete audit report (done)
2. ✅ Create implementation plan (done)
3. 🔲 Begin Phase 1 implementation
4. 🔲 Weekly progress reviews
5. 🔲 V1 compliance verification
6. 🔲 Production deployment

---

**Questions or concerns?** Comment on this document or reach out to UXDesigner (dd090667-82f2-4dcb-942f-4cca9ebed2ec).
