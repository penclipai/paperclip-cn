# Windows desktop shutdown and uninstall verification

## Observed failure

The installed desktop app exited with code zero and closed its HTTP and database
ports, but a PostgreSQL subprocess still held the installed `postgres.exe` image.
The NSIS uninstaller exited zero and removed its registration, while the complete
uninstall check failed because the executable and its parent directories remained.
Windows Restart Manager identified the process using that exact installed file.

The desktop main process currently sends `ChildProcess.kill("SIGTERM")`. On
Windows this forcibly terminates the worker instead of running its JavaScript
signal handler. The worker also fails to call the `shutdown()` function returned
by `startServer()`. Its disconnect fallback can report success before database
cleanup finishes. See the [Node child-process contract](https://nodejs.org/api/child_process.html#subprocesskillsignal).

## Repair boundary

- Keep the change inside the desktop wrapper and its existing smoke checks.
  Preserve the generic server and embedded PostgreSQL manager contracts.
- Request shutdown over the existing IPC channel. Require a matching request ID,
  a completed cleanup response, and worker exit code zero for graceful success.
- Await the same startup promise when shutdown arrives during startup. Suppress
  readiness after a shutdown request and call the returned shutdown function once.
- Reuse that shutdown operation after parent disconnection. Report cleanup
  rejection or expiry as failure; do not exit zero from an incomplete fallback.
- Allow the ordered server teardown to finish before the existing exact-worker
  process-tree fallback. The main budget is 120 seconds; a disconnected worker
  has a 115-second failure deadline. Repeated quit events must keep awaiting the
  same operation.
- Do not add dependencies or terminate processes by executable name.

## Regression and acceptance

1. Add failing worker protocol regressions before changing implementation:
   readiness, startup races, duplicate requests, rejected cleanup, and parent
   disconnection. Test matching acknowledgements, missing acknowledgements, and
   bounded failure in the main-process coordinator.
2. Run desktop tests and typecheck, then review the implementation independently.
3. Extend existing smoke checks to confirm that the captured postmaster PID exits.
   An inaccessible PID is not evidence of exit. This check alone does not cover
   detached database subprocesses.
4. Extend installed-app acceptance and the uninstall preflight with native image
   queries. WMI's empty executable path is not absence. Check the unique installed
   directory, preserve PID and creation-time evidence, and refuse uninstall when
   installed images remain active or cannot be resolved safely.
5. Preserve the failed installer receipt. Build and seal a new complete package,
   prove SDK/workspace links stay intact, repeat core and real Grok acceptance,
   and require complete uninstall plus data retention before restoring the app.
6. Keep all test profiles, compilation caches and temporary paths on D:. Complete
   the remaining all-users/UAC checks before merge. Formal signing, version
   selection and distribution remain separate release gates.

## Stop condition

The new package must close its owned native processes and uninstall without
manual file or process cleanup. Historical failed receipts and any manual
recovery remain separate evidence and cannot be counted as a passing lifecycle.
