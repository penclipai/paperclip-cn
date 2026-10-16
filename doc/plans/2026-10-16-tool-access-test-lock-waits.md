# Tool access lock-wait test repair

## Scope

Stabilize the existing concurrency tests in `server/src/__tests__/tool-access-service.test.ts` without changing product behavior, schemas, APIs, or test deadlines.

## Plan

1. Replace the text-based `pg_stat_activity` polling helper with a bounded asynchronous assertion against the known lock-holder backend PID.
2. Capture each lock holder's `pg_backend_pid()` inside its transaction before starting the competing operation.
3. Put the paused delegation and audience-replacement transactions behind `try`/`finally` cleanup so assertion failures release gates, begin dedicated-pool closure before settlement, and bound cleanup waits without replacing the original assertion failure.
4. Run the targeted test file through the D-drive pinned command wrapper after review approval.

## Acceptance criteria

- The tests prove blocking against the transaction that actually holds the target lock.
- Lock-observation waits and the new cleanup waits have explicit bounds. Cleanup releases intentional gates and begins dedicated-pool shutdown before waiting for operations to settle.
- Existing authorization and fail-closed assertions remain unchanged.

## Verification

- On Windows, both changed lock-observation tests passed. The other 420 cases were not selected in that focused run.
- The complete `tool-access-service.test.ts` then passed all 422 tests without skipped cases, using the server project, forks, one worker, and `--bail=1`.
- Server typecheck passed. These commands ran with task profiles, compiler caches, and temporary paths on D:.
- The earlier complete Windows run remains a stalled baseline. These targeted results do not replace a fresh complete-suite run.
