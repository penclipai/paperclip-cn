# V1 Technical Decisions - Scope Deferrals

**Date:** 2026-04-05
**Author:** CTO
**Status:** Final

## Context

As Paperclip approaches V1 release, several features have been built that exceed the core V1 specification defined in `doc/SPEC-implementation.md`. This document formalizes the decisions on what to include, defer, or gate behind feature flags for V1.

---

## D1: Plugin System Scope

### Status
- **Implementation:** Complete
- **Schema:** `plugins`, `plugin_config`, `plugin_entities`, `plugin_jobs`, `plugin_job_runs`, `plugin_logs`, `plugin_state`, `plugin_webhook_deliveries`, `plugin_company_settings` (9 tables)
- **Code:** Service layer, SDK package (`@penclipai/plugins`), route handlers

### Decision: **DEFERRED - Feature Flagged Off**

The plugin system is **out of V1 scope** per the core specification. While the infrastructure is built and functional, it introduces additional complexity and potential security surface area that should not ship in the first stable release.

### Action Items
- [x] Ensure `ENABLE_PLUGINS` environment variable defaults to `false` in production configs
- [ ] Document plugin system as "experimental preview" in developer docs
- [ ] Add feature flag check to plugin routes (gate behind `ENABLE_PLUGINS=true`)
- [ ] Exclude plugin tables from default company exports unless explicitly enabled

### Rationale
- V1 focus is on core control plane reliability
- Plugin ecosystem needs more design iteration on security model
- Early adopters can enable manually for testing
- Deferring reduces attack surface and support burden

### Impact
- **Code:** Remains in codebase, not loaded by default
- **Docs:** Mention as "coming soon" in V1 release notes
- **Migration:** No plugin tables created in fresh installs unless flag is set

---

## D2: Desktop Electron Wrapper

### Status
- **Implementation:** Partially complete
- **Location:** `cli/src/commands/desktop.ts` and related
- **Features:** Basic Electron shell wrapping the web UI

### Decision: **DEFERRED - Experimental**

The Electron desktop wrapper is **not part of V1**. It was an exploratory addition that provides value for local development but is not ready for general release.

### Action Items
- [ ] Document desktop wrapper as "experimental - not for production use"
- [ ] Exclude from V1 release binaries and installers
- [ ] Keep code in repository for future development
- [ ] Add warning banner when running in desktop mode

### Rationale
- V1 target is server-first deployment model
- Desktop wrapper needs code signing, auto-update infrastructure
- Platform-specific testing and packaging not yet automated
- Adds significant CI/CD complexity

### Impact
- **Code:** Stays in repository, not included in V1 release
- **Docs:** Document build command for developers only
- **Future:** Candidate for V1.1 or V2 depending on demand

---

## D3: Multi-User Collaboration

### Status
- **Schema:** Complete (`company_memberships`, `invites`, `join_requests`, `instance_user_roles`)
- **Implementation:** Partial - basic membership model exists
- **Missing:** Full invite flow, email notifications, role-based access control UI

### Decision: **DEFERRED - Single Board Operator Only**

Full multi-user collaboration is **out of V1 scope**. V1 will support a single board operator per company with the ability to hire and manage agents. Multi-user support will be hardened and completed in a subsequent release.

### Action Items
- [ ] Ensure single-board-operator mode is rock solid
- [ ] Disable invite UI in V1 (gate behind `ENABLE_MULTI_USER` flag, default false)
- [ ] Document that V1 supports single user per company
- [ ] Ensure no data leaks between company members (verify company_id scoping)
- [ ] Add membership count checks to prevent accidental multi-user setups

### Rationale
- V1 focus is on agent orchestration correctness, not collaboration
- Invite flow requires email infrastructure, localization, spam prevention
- Role-based permissions need more product design work
- Single-user model simplifies testing and initial onboarding

### Impact
- **Code:** Membership schema exists, invite flows hidden
- **Docs:** Clearly state V1 is single-user per company
- **Migration:** Company creation defaults to single owner, no invites sent

---

## Additional V1 Scope Decisions

### D4: Circuit Breaker for Agents

**Decision:** **INCLUDED IN V1**

The circuit breaker system (implemented 2026-04-05) is included in V1 as it provides critical operational stability for autonomous agent runs. It prevents runaway failure loops and provides visibility into agent health.

- Automatically pauses agents after consecutive failures
- Provides retry mechanism with configurable delays
- Logs circuit breaker state changes to activity log
- API endpoints for monitoring and manual intervention

### D5: Issue Execution Lock

**Decision:** **INCLUDED IN V1**

The issue execution lock system is already fully implemented and active. It provides critical conflict prevention for concurrent agent operations.

- Prevents race conditions in issue checkout
- Atomic locking via database transactions
- Already tested and verified stable

---

## Summary Matrix

| Feature | Built? | In V1? | Visibility | Notes |
|---------|--------|--------|------------|-------|
| Plugin System | ✅ | ❌ | Hidden behind flag | Manual enable for testing |
| Desktop Electron | ⚠️ Partial | ❌ | Developer only | Not in release binaries |
| Multi-User Collaboration | ⚠️ Partial | ❌ | Single user only | V1 is single board operator |
| Circuit Breaker | ✅ | ✅ | Active | New for V1 |
| Issue Execution Lock | ✅ | ✅ | Active | Already active |
| Core Agent Mgmt | ✅ | ✅ | Active | V1 complete |
| Budget Enforcement | ✅ | ✅ | Active | V1 complete |
| Task Orchestration | ✅ | ✅ | Active | V1 complete |

---

## Next Steps

1. **Before V1 Release:**
   - Add feature flag checks for deferred features
   - Update documentation to clarify V1 scope
   - Ensure fresh installs don't expose deferred features by default

2. **Post-V1 Planning:**
   - Prioritize D3 (Multi-User) for V1.1
   - Evaluate D1 (Plugins) for V2 based on community demand
   - Consider D2 (Desktop) if local-first use case emerges

3. **Communication:**
   - Update SPEC.md to clarify V1 scope exclusions
   - Add "Coming Soon" section to release notes for deferred features
   - Document manual enablement paths for early adopters

---

## References

- V1 Specification: `doc/SPEC-implementation.md`
- CTO V1 Technical Plan: `doc/plans/2026-04-05-cto-v1-technical-plan.md`
- Schema Alignment Audit: `doc/plans/2026-04-05-schema-alignment-audit.md`
