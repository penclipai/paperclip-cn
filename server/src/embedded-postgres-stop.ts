import { execFile } from "node:child_process";
import { readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const STOP_TIMEOUT_MS = 31_000;

export type EmbeddedPostgresChild = {
  pid?: number;
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  removeListener?: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
  off?: (event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void) => unknown;
};

export type WindowsOwnedEmbeddedPostgresInstance = {
  process?: EmbeddedPostgresChild;
  stop(): Promise<void>;
};

type BinaryPaths = { pgCtl: string | null };

export type WindowsNativePostgresStopInput = {
  childPid: number;
  dataDir: string;
  deadlineEpochMs: number;
  pgCtlPath: string;
  postmasterDataDir: string;
  postmasterStartedAtEpoch: number;
  timeoutMs: number;
};

export type WindowsNativePostgresStopResult = {
  closureComplete: boolean;
  forkChildrenObserved: number;
  forkChildrenTerminated: number;
  pgCtlExitCode: number | null;
  pgCtlManagedExitCode: number | null;
  pgCtlSucceeded: boolean;
  rootExited: boolean;
  rootExitCode: number | null;
  rootIdentityVerified: boolean;
  unknownChildren: number;
  errorCode?: string;
};

type StopOptions = {
  instance: WindowsOwnedEmbeddedPostgresInstance;
  dataDir: string;
  pgCtlPath: BinaryPaths["pgCtl"];
  canonicalizeWindowsDataDirectory?: (value: string) => string;
  readFile?: (filePath: string) => string;
  runWindowsNativeStop?: (input: WindowsNativePostgresStopInput) => Promise<WindowsNativePostgresStopResult>;
  timeoutMs?: number;
};

function canonicalizeWindowsDataDirectory(value: string): string {
  return realpathSync.native(resolve(value)).replaceAll("/", "\\").toLowerCase();
}

function readOwnedPostmasterPid(
  contents: string,
  dataDir: string,
  childPid: number,
  canonicalize: (value: string) => string,
): { pidDataDir: string; startedAtEpoch: number } {
  const [pidText, pidDataDir, startedAtEpochText] = contents.split(/\r?\n/);
  if (Number(pidText) !== childPid || !pidDataDir || canonicalize(pidDataDir) !== canonicalize(dataDir)) {
    throw new Error("Refusing to stop embedded PostgreSQL because postmaster.pid does not match the owned child process.");
  }
  const startedAtEpoch = Number(startedAtEpochText);
  if (!Number.isSafeInteger(startedAtEpoch) || startedAtEpoch <= 0) {
    throw new Error("Refusing to stop embedded PostgreSQL because postmaster.pid has no valid start epoch.");
  }
  return { pidDataDir, startedAtEpoch };
}

function waitForChildExit(child: EmbeddedPostgresChild): {
  promise: Promise<void>;
  cleanup: () => void;
  exited: () => boolean;
  outcome: () => { code: number | null; signal: NodeJS.Signals | null } | null;
} {
  if (child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined) {
    throw new Error("Refusing to stop embedded PostgreSQL because its owned child process has already exited.");
  }
  let listener: ((code: number | null, signal: NodeJS.Signals | null) => void) | null = null;
  let exited = false;
  let outcome: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  const promise = new Promise<void>((resolveExit) => {
    listener = (code, signal) => {
      exited = true;
      outcome = { code, signal };
      resolveExit();
    };
    child.once("exit", listener);
  });
  return {
    promise,
    cleanup: () => {
      if (!listener) return;
      if (child.removeListener) child.removeListener("exit", listener);
      else child.off?.("exit", listener);
      listener = null;
    },
    exited: () => exited || child.exitCode !== null && child.exitCode !== undefined || child.signalCode !== null && child.signalCode !== undefined,
    outcome: () => outcome,
  };
}

// Keep the root handle open across pg_ctl so every native identity check stays
// bound to that process object. A held handle does not forbid later PID reuse;
// it prevents a reused PID from being mistaken for this root. The helper emits
// only a small status object, never command lines or environment data.
const WINDOWS_NATIVE_STOP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$paperclipInput = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($paperclipInputBase64)) | ConvertFrom-Json
$native = @'
using System;
using System.Runtime.InteropServices;
public static class PaperclipNativeProcess {
 [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool i, uint p);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool CloseHandle(IntPtr h);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetProcessTimes(IntPtr h, out long c, out long e, out long k, out long u);
 [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool QueryFullProcessImageName(IntPtr h, uint f, System.Text.StringBuilder n, ref uint s);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern uint WaitForSingleObject(IntPtr h, uint m);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetExitCodeProcess(IntPtr h, out uint c);
 [DllImport("kernel32.dll", SetLastError=true)] public static extern bool TerminateProcess(IntPtr h, uint c);
}
'@
Add-Type -TypeDefinition $native
$query=0x1000; $sync=0x100000; $terminate=1; $signaled=0; $timeout=258
function Open-Owned([uint32]$processId, [bool]$canTerminate) { $access=$query -bor $sync; if ($canTerminate) {$access=$access -bor $terminate}; [PaperclipNativeProcess]::OpenProcess($access,$false,$processId) }
function Identity([IntPtr]$h,[uint32]$processId) {
 [long]$created=0;[long]$exited=0;[long]$kernel=0;[long]$user=0
 if(-not [PaperclipNativeProcess]::GetProcessTimes($h,[ref]$created,[ref]$exited,[ref]$kernel,[ref]$user)){throw 'process_times_unavailable'}
 $size=32768;$name=New-Object System.Text.StringBuilder $size
 if(-not [PaperclipNativeProcess]::QueryFullProcessImageName($h,0,$name,[ref]$size)){throw 'process_image_unavailable'}
 $cim=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$processId) -ErrorAction Stop
 if($null -eq $cim){throw 'process_metadata_unavailable'}
 [PSCustomObject]@{Created=$created;Image=$name.ToString();Parent=[uint32]$cim.ParentProcessId;CommandLine=[string]$cim.CommandLine}
}
function DirectChildren([uint32]$parent) { @(Get-CimInstance Win32_Process -Filter ("ParentProcessId = "+$parent) -ErrorAction Stop | ForEach-Object {[uint32]$_.ProcessId}) }
function RemainingMilliseconds() { [Math]::Max(0, [Int64]$paperclipInput.deadlineEpochMs - [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) }
function Require-Remaining() { if((RemainingMilliseconds) -le 0){throw 'shutdown_deadline_elapsed'} }
function Quote-WindowsArgument([string]$value) {
 $out=New-Object System.Text.StringBuilder;[void]$out.Append([char]34);$slashes=0
 foreach($char in $value.ToCharArray()){
  if($char -eq [char]92){$slashes++;continue}
  if($char -eq [char]34){[void]$out.Append(('\' * (($slashes * 2) + 1)));[void]$out.Append($char);$slashes=0;continue}
  if($slashes -gt 0){[void]$out.Append(('\' * $slashes));$slashes=0};[void]$out.Append($char)
 }
 if($slashes -gt 0){[void]$out.Append(('\' * ($slashes * 2)))};[void]$out.Append([char]34);$out.ToString()
}
$r=[ordered]@{closureComplete=$false;forkChildrenObserved=0;forkChildrenTerminated=0;pgCtlExitCode=$null;pgCtlManagedExitCode=$null;pgCtlSucceeded=$false;rootExited=$false;rootExitCode=$null;rootIdentityVerified=$false;unknownChildren=0}
$root=[IntPtr]::Zero
$deferredUnknownHandles=@()
try {
 Require-Remaining
 $lines=@(Get-Content -LiteralPath (Join-Path ([string]$paperclipInput.dataDir) 'postmaster.pid') -Encoding UTF8 -ErrorAction Stop)
 if($lines.Count -lt 3 -or [uint32]$lines[0] -ne [uint32]$paperclipInput.childPid){throw 'postmaster_pid_mismatch'}
 if(-not [string]::Equals([string]$lines[1],[string]$paperclipInput.postmasterDataDir,[StringComparison]::Ordinal) -or -not [string]::Equals([string]$lines[2],[string]$paperclipInput.postmasterStartedAtEpoch,[StringComparison]::Ordinal)){throw 'postmaster_marker_changed'}
 $markerEpoch=[Int64]$paperclipInput.postmasterStartedAtEpoch
 $root=Open-Owned ([uint32]$paperclipInput.childPid) $false;if($root -eq [IntPtr]::Zero){throw 'root_open_failed'}
 $rootIdentity=Identity $root ([uint32]$paperclipInput.childPid)
 $expectedImage=Join-Path (Split-Path -Parent ([string]$paperclipInput.pgCtlPath)) 'postgres.exe'
 if(-not [string]::Equals($rootIdentity.Image,$expectedImage,[StringComparison]::OrdinalIgnoreCase)){throw 'root_image_mismatch'}
 $rootStartedAt=[DateTimeOffset]::FromFileTime($rootIdentity.Created).ToUnixTimeMilliseconds()
 if($rootStartedAt -gt (($markerEpoch + 1) * 1000) -or $rootStartedAt -lt (($markerEpoch - 300) * 1000)){throw 'root_start_epoch_mismatch'}
 if([PaperclipNativeProcess]::WaitForSingleObject($root,0) -ne $timeout){throw 'root_exited_before_stop'}
 $r.rootIdentityVerified=$true;$pre=@(DirectChildren ([uint32]$paperclipInput.childPid));Require-Remaining
 # pg_ctl retains its normal 30-second grace. The held Process wait below is
 # the absolute shutdown budget and kills only this exact pg_ctl instance.
 $pgSeconds=30
 $pgRawArgs=@('-D',[string]$paperclipInput.dataDir,'stop','-m','fast','-w','-t',[string]$pgSeconds)
 $pgArgs=(@($pgRawArgs | ForEach-Object { Quote-WindowsArgument ([string]$_) })) -join ' '
 Require-Remaining
 $pg=$null
 $pgHandle=[IntPtr]::Zero
 try {
  $pg=Start-Process -FilePath ([string]$paperclipInput.pgCtlPath) -ArgumentList $pgArgs -PassThru -WindowStyle Hidden
  # Force the native handle to be created before the child can exit. Windows
  # PowerShell otherwise may expose an incomplete Process object after Wait.
  $pgHandle=[IntPtr]$pg.Handle
  if($pgHandle -eq [IntPtr]::Zero){throw 'pg_ctl_handle_unavailable'}
  $pgRemaining=[int](RemainingMilliseconds)
  if($pgRemaining -le 0 -or -not $pg.WaitForExit($pgRemaining)){
   # This is the exact Process instance just started; never reopen or target a PID.
   if(-not $pg.HasExited){$pg.Kill();$killRemaining=[int](RemainingMilliseconds);if($killRemaining -gt 0){[void]$pg.WaitForExit($killRemaining)}}
   throw 'shutdown_deadline_elapsed'
  }
  $managedPgExitCode=$pg.ExitCode
  if($null -ne $managedPgExitCode){$r.pgCtlManagedExitCode=[int64]$managedPgExitCode}
  [uint32]$pgExitCode=0;if(-not [PaperclipNativeProcess]::GetExitCodeProcess($pgHandle,[ref]$pgExitCode)){throw 'pg_ctl_exit_code_unavailable'};$r.pgCtlExitCode=[int64]$pgExitCode
  if($managedPgExitCode -ne 0 -or $pgExitCode -ne 0){throw 'pg_ctl_failed'};$r.pgCtlSucceeded=$true
 } finally {if($null -ne $pg){$pg.Dispose()}}
 Require-Remaining;$remaining=[uint32](RemainingMilliseconds)
 if([PaperclipNativeProcess]::WaitForSingleObject($root,[uint32]$remaining) -ne $signaled){throw 'root_exit_timeout'};$r.rootExited=$true
 [uint32]$rootExitCode=0;if(-not [PaperclipNativeProcess]::GetExitCodeProcess($root,[ref]$rootExitCode)){throw 'root_exit_code_unavailable'};$r.rootExitCode=[int64]$rootExitCode;if($rootExitCode -ne 0){throw 'root_exit_code_nonzero'}
 [long]$rootCreated=0;[long]$rootExited=0;[long]$k=0;[long]$u=0
 if(-not [PaperclipNativeProcess]::GetProcessTimes($root,[ref]$rootCreated,[ref]$rootExited,[ref]$k,[ref]$u) -or $rootExited -le 0){throw 'root_exit_time_unavailable'}
 $candidates=@($pre + @(DirectChildren ([uint32]$paperclipInput.childPid)) | Select-Object -Unique)
 foreach($candidatePid in $candidates){
  if($candidatePid -eq 0 -or $candidatePid -eq [uint32]$paperclipInput.childPid){throw 'invalid_direct_child'}
  Require-Remaining
  $candidate=Open-Owned $candidatePid $true
  if($candidate -eq [IntPtr]::Zero){
   # A vanished candidate is already closed. A still-visible one that cannot
   # be opened is an ownership failure, never a reason to target it by PID.
   try { if($null -ne (Get-CimInstance Win32_Process -Filter ("ProcessId = "+$candidatePid) -ErrorAction Stop)){$r.unknownChildren++} } catch {$r.unknownChildren++}
   continue
  }
  try {
   # An already exited direct child needs neither metadata nor classification.
   $candidateState=[PaperclipNativeProcess]::WaitForSingleObject($candidate,0)
   if($candidateState -eq $signaled){continue}
   if($candidateState -ne $timeout){$r.unknownChildren++;continue}
   $identity=Identity $candidate $candidatePid
   if($identity.Parent -ne [uint32]$paperclipInput.childPid -or $identity.Created -lt $rootCreated -or $identity.Created -gt $rootExited -or -not [string]::Equals($identity.Image,$rootIdentity.Image,[StringComparison]::OrdinalIgnoreCase) -or $identity.CommandLine -notmatch '(^|[\s"])--forkchild(?:=|\s|$)'){$deferredUnknownHandles += $candidate;$candidate=[IntPtr]::Zero;continue}
   $r.forkChildrenObserved++
   if([PaperclipNativeProcess]::WaitForSingleObject($candidate,0) -eq $timeout){$candidateRemaining=[uint32](RemainingMilliseconds);if($candidateRemaining -eq 0){throw 'shutdown_deadline_elapsed'};if(-not [PaperclipNativeProcess]::TerminateProcess($candidate,1)){throw 'forkchild_terminate_failed'};if([PaperclipNativeProcess]::WaitForSingleObject($candidate,$candidateRemaining) -ne $signaled){throw 'forkchild_exit_timeout'};$r.forkChildrenTerminated++}
  } finally {if($candidate -ne [IntPtr]::Zero){[void][PaperclipNativeProcess]::CloseHandle($candidate)}}
 }
 $settleDeadline=[Math]::Min([Int64]$paperclipInput.deadlineEpochMs,[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()+1000)
 foreach($unknownHandle in $deferredUnknownHandles){
  try {
   $settleRemaining=[Int64]$settleDeadline-[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
   if($settleRemaining -le 0 -or [PaperclipNativeProcess]::WaitForSingleObject($unknownHandle,[uint32]$settleRemaining) -ne $signaled){$r.unknownChildren++}
  } finally {[void][PaperclipNativeProcess]::CloseHandle($unknownHandle)}
 }
 $deferredUnknownHandles=@()
 if($r.unknownChildren -ne 0){throw 'unverified_direct_child'};$r.closureComplete=$true
} catch {$candidateCode=[string]$_.Exception.Message;if($candidateCode -match '^[a-z_]{1,64}$'){$r.errorCode=$candidateCode}else{$r.errorCode='native_operation_failed'}} finally {foreach($unknownHandle in $deferredUnknownHandles){if($unknownHandle -ne [IntPtr]::Zero){[void][PaperclipNativeProcess]::CloseHandle($unknownHandle)}};if($root -ne [IntPtr]::Zero){[void][PaperclipNativeProcess]::CloseHandle($root)}}
[Console]::Out.WriteLine(($r | ConvertTo-Json -Compress))
`;

export async function runWindowsNativePostgresStop(input: WindowsNativePostgresStopInput): Promise<WindowsNativePostgresStopResult> {
  const payload = Buffer.from(JSON.stringify(input), "utf8").toString("base64");
  const script = Buffer.from(`$paperclipInputBase64 = '${payload}'\n${WINDOWS_NATIVE_STOP_SCRIPT}`, "utf16le").toString("base64");
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", script], { windowsHide: true, timeout: input.timeoutMs }));
  } catch {
    // execFile's error may contain the encoded script and JSON payload. Neither
    // belongs in shutdown logs, even though the helper itself is non-secret.
    throw new Error("Windows embedded PostgreSQL stop helper failed.");
  }
  try { return JSON.parse(stdout.trim()) as WindowsNativePostgresStopResult; }
  catch { throw new Error("Windows embedded PostgreSQL stop helper returned invalid status."); }
}

function hasCleanNativeRootExit(result: WindowsNativePostgresStopResult): boolean {
  return result.rootIdentityVerified === true && result.pgCtlSucceeded === true && result.rootExited === true && result.rootExitCode === 0;
}

function assertNativeClosure(result: WindowsNativePostgresStopResult): void {
  if (!hasCleanNativeRootExit(result) || result.closureComplete !== true || !Number.isSafeInteger(result.forkChildrenObserved) || result.forkChildrenObserved < 0 || !Number.isSafeInteger(result.forkChildrenTerminated) || result.forkChildrenTerminated < 0 || !Number.isSafeInteger(result.unknownChildren) || result.unknownChildren !== 0) {
    const suffix = typeof result.errorCode === "string" && /^[a-z_]{1,64}$/.test(result.errorCode)
      ? ` (${result.errorCode})`
      : "";
    throw new Error(`Windows embedded PostgreSQL stop did not prove owned process closure${suffix}.`);
  }
}

/** Stops only the cluster whose direct child and pid file identify this server. */
export async function stopOwnedEmbeddedPostgresOnWindows(options: StopOptions): Promise<void> {
  const child = options.instance.process;
  const childPid = child?.pid;
  if (!child || typeof childPid !== "number" || !Number.isSafeInteger(childPid) || childPid <= 0) {
    throw new Error("Refusing to stop embedded PostgreSQL because no owned child process is available.");
  }
  const childExit = waitForChildExit(child);
  let timer: NodeJS.Timeout | null = null;
  try {
    const readFile = options.readFile ?? ((filePath: string) => readFileSync(filePath, "utf8"));
    const canonicalize = options.canonicalizeWindowsDataDirectory ?? canonicalizeWindowsDataDirectory;
    const marker = readOwnedPostmasterPid(readFile(resolve(options.dataDir, "postmaster.pid")), options.dataDir, childPid, canonicalize);
    if (childExit.exited()) {
      throw new Error("Refusing to stop embedded PostgreSQL because its owned child process has already exited.");
    }
    if (!options.pgCtlPath) throw new Error("Refusing to stop embedded PostgreSQL because this runtime has no pg_ctl binary.");

    const timeoutMs = options.timeoutMs ?? STOP_TIMEOUT_MS;
    const deadlineEpochMs = Date.now() + timeoutMs;
    const runNativeStop = options.runWindowsNativeStop ?? runWindowsNativePostgresStop;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Timed out waiting for owned embedded PostgreSQL to stop.")), timeoutMs);
      timer.unref?.();
    });
    const [nativeResult] = await Promise.race([
      Promise.all([
        runNativeStop({ childPid, dataDir: options.dataDir, deadlineEpochMs, pgCtlPath: options.pgCtlPath, postmasterDataDir: marker.pidDataDir, postmasterStartedAtEpoch: marker.startedAtEpoch, timeoutMs }),
        childExit.promise,
      ]),
      timeout,
    ]);
    if (options.instance.process !== child) {
      throw new Error("Refusing to finish embedded PostgreSQL stop because the owned child process was replaced.");
    }
    const childOutcome = childExit.outcome();
    if (hasCleanNativeRootExit(nativeResult) && childOutcome?.code === 0 && childOutcome.signal === null) {
      // The root instance has conclusively exited. Detach it before the final
      // closure assertion so a later vendor exit hook cannot target a reused PID.
      options.instance.process = undefined;
    }
    if (childOutcome?.code !== 0 || childOutcome.signal !== null) {
      throw new Error("Refusing to finish embedded PostgreSQL stop because the owned child did not exit cleanly.");
    }
    assertNativeClosure(nativeResult);
    // Both the Node child and the retained native root handle have exited, and
    // every verified same-window direct --forkchild has exited. Only now can
    // the vendor exit hook see no child to taskkill.
  } finally {
    if (timer) clearTimeout(timer);
    childExit.cleanup();
  }
}
