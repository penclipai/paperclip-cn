import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { runWindowsNativePostgresStop, stopOwnedEmbeddedPostgresOnWindows, type WindowsNativePostgresStopInput, type WindowsNativePostgresStopResult } from "./embedded-postgres-stop.js";

const owner = `paperclip-native-stop-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tempParent = realpathSync(tmpdir());
const root = process.platform === "win32" ? mkdtempSync(join(tempParent, "paperclip-native-stop-")) : join(tempParent, "paperclip-native-stop-skipped");
const postgres = join(root, "postgres.exe");
const pgCtl = join(root, "pg_ctl.exe");
const systemPowerShell = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
const heldRoots: ChildProcess[] = [];
let cleanupFailed = false;
let testFailed = false;

const fixtureSource = String.raw`
using System; using System.Diagnostics; using System.IO; using System.Linq; using System.Runtime.InteropServices; using System.Text; using System.Threading;
class NativeFixture {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO { public int cb; public string lpReserved,lpDesktop,lpTitle; public int dwX,dwY,dwXSize,dwYSize,dwXCountChars,dwYCountChars,dwFillAttribute,dwFlags; public short wShowWindow,cbReserved2; public IntPtr lpReserved2,hStdInput,hStdOutput,hStdError; }
 [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess,hThread; public int dwProcessId,dwThreadId; }
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string applicationName,StringBuilder commandLine,IntPtr processAttributes,IntPtr threadAttributes,bool inheritHandles,uint flags,IntPtr environment,string currentDirectory,ref STARTUPINFO startupInfo,out PROCESS_INFORMATION processInformation);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr handle,out long created,out long exited,out long kernel,out long user);
 [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint processId);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr handle,out uint exitCode);
 [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr handle,uint exitCode);
 [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
 const uint CREATE_SUSPENDED=4;
 static long EpochSeconds() { return (DateTime.UtcNow.Ticks-621355968000000000L)/10000000L; }
 static string SafeException(Exception e) { if(e is InvalidOperationException)return "invalid_operation"; if(e is IOException)return "io"; if(e is System.ComponentModel.Win32Exception)return "win32"; return "unexpected"; }
 static void WritePgCtlException(string data, Exception e) { File.WriteAllText(Path.Combine(data,"pgctl-exception.safe.json"),"{\"type\":\""+e.GetType().Name+"\",\"message\":\""+SafeException(e)+"\"}"); }
 static void WriteIdentity(string data, int pid, string image, long created) { File.WriteAllText(Path.Combine(data,"fixture-child.json"), pid+"|"+image+"|"+created); }
 static void Main(string[] args) {
  if(args.Length>0 && (args[0]=="--forkchild=fixture" || args[0]=="--foreign-held")){Thread.Sleep(Timeout.Infinite);return;}
  if(Path.GetFileName(Process.GetCurrentProcess().MainModule.FileName).Equals("pg_ctl.exe",StringComparison.OrdinalIgnoreCase)){PgCtl(args);return;}
  string data=args[1]; bool foreign=args.Contains("--foreign-child"); Directory.CreateDirectory(data);
  Process root=Process.GetCurrentProcess(); File.WriteAllText(Path.Combine(data,"postmaster.pid"),root.Id+"\n"+data+"\n"+EpochSeconds()+"\n"); File.WriteAllText(Path.Combine(data,"owner.pid"),root.Id.ToString());
  string self=root.MainModule.FileName;
  if(foreign){string foreignPath=Path.Combine(Path.GetDirectoryName(self),"foreign.exe");File.Copy(self,foreignPath,true);Process foreignChild=Process.Start(foreignPath,"--foreign-held");try{WriteIdentity(data,foreignChild.Id,foreignPath,foreignChild.StartTime.ToFileTimeUtc());}catch{foreignChild.Kill();foreignChild.WaitForExit();Environment.Exit(75);}}
  else { STARTUPINFO si=new STARTUPINFO();si.cb=Marshal.SizeOf(si);PROCESS_INFORMATION pi;StringBuilder commandLine=new StringBuilder("\""+self+"\" --forkchild=fixture");if(!CreateProcessW(self,commandLine,IntPtr.Zero,IntPtr.Zero,false,CREATE_SUSPENDED,IntPtr.Zero,null,ref si,out pi))Environment.Exit(71);try{long created=0,exited=0,kernel=0,user=0;if(!GetProcessTimes(pi.hProcess,out created,out exited,out kernel,out user))throw new Exception("fork_identity_unavailable");WriteIdentity(data,pi.dwProcessId,self,created);}catch{TerminateProcess(pi.hProcess,74);WaitForSingleObject(pi.hProcess,5000);Environment.Exit(74);}finally{CloseHandle(pi.hThread);CloseHandle(pi.hProcess);} }
  while(!File.Exists(Path.Combine(data,"stop.owner")))Thread.Sleep(10);File.Delete(Path.Combine(data,"postmaster.pid"));
 }
 static void PgCtl(string[] args) {
  string data=args.Length>1?args[1]:"";try{File.WriteAllText(Path.Combine(data,"argv.txt"),String.Join("\u001f",args));
  int seconds; if(args.Length!=8 || args[0]!="-D" || args[2]!="stop" || args[3]!="-m" || args[4]!="fast" || args[5]!="-w" || args[6]!="-t" || !Int32.TryParse(args[7],out seconds) || seconds<1 || seconds>30)Environment.Exit(72);
  uint rootId=UInt32.Parse(File.ReadAllText(Path.Combine(data,"owner.pid")));IntPtr rootHandle=OpenProcess(0x101000,false,rootId);if(rootHandle==IntPtr.Zero)Environment.Exit(74);try{File.WriteAllText(Path.Combine(data,"stop.owner"),"stop");if(WaitForSingleObject(rootHandle,30000)!=0)Environment.Exit(75);uint rootExitCode=0;if(!GetExitCodeProcess(rootHandle,out rootExitCode) || rootExitCode!=0)Environment.Exit(76);}finally{CloseHandle(rootHandle);}
  }catch(Exception e){WritePgCtlException(data,e);Environment.Exit(77);}
 }
}`;

type Fixture = { child: ChildProcess; dataDir: string };
const encodePowerShell = (script: string) => Buffer.from(script, "utf16le").toString("base64");

function fixtureCompileCommand(source: string, output: string): string {
  const sourceBase64 = Buffer.from(source, "utf8").toString("base64");
  const outputBase64 = Buffer.from(output, "utf8").toString("base64");
  return `$ErrorActionPreference='Stop';$s=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${sourceBase64}'));$o=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${outputBase64}'));Add-Type -TypeDefinition $s -OutputAssembly $o -OutputType ConsoleApplication`;
}

async function waitForReady(file: string, child: ChildProcess, timeoutMs = 5_000): Promise<void> {
  let childError: Error | undefined;
  child.once("error", (error) => { childError = error; });
  const deadline = Date.now() + timeoutMs;
  while (!existsSync(file)) {
    if (childError) throw childError;
    if (child.exitCode !== null || child.signalCode !== null) throw new Error("fixture root exited before becoming ready");
    if (Date.now() >= deadline) throw new Error(`fixture did not create ${file}`);
    await new Promise((resolveTimer) => setTimeout(resolveTimer, 20));
  }
}

async function launch(name: string, foreign = false): Promise<Fixture> {
  const dataDir = join(root, `${name} 数据目录 with spaces`);
  mkdirSync(dataDir, { recursive: true });
  const child = spawn(postgres, ["--data", dataDir, ...(foreign ? ["--foreign-child"] : [])], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk: Buffer) => appendFileSync(join(dataDir, "root-stdout.log"), chunk));
  child.stderr?.on("data", (chunk: Buffer) => appendFileSync(join(dataDir, "root-stderr.log"), chunk));
  child.once("exit", (code, signal) => writeFileSync(join(dataDir, "root-exit.json"), JSON.stringify({ code, signal, observedAtEpochMs: Date.now() })));
  heldRoots.push(child);
  await waitForReady(join(dataDir, "fixture-child.json"), child);
  return { child, dataDir };
}

function assertVerifiedFixtureChildState(dataDir: string, expectedState: "closed" | "running"): void {
  const [pid, image, created] = readFileSync(join(dataDir, "fixture-child.json"), "utf8").split("|");
  const payload = Buffer.from(JSON.stringify({ pid: Number(pid), image, created, expectedState }), "utf8").toString("base64");
  const script = String.raw`$x=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;$n=@'
using System;using System.Runtime.InteropServices;using System.Text;
public static class FixtureClosed { [DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint a,bool i,uint p);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool QueryFullProcessImageName(IntPtr h,uint f,StringBuilder n,ref uint s);[DllImport("kernel32.dll",SetLastError=true)]public static extern uint WaitForSingleObject(IntPtr h,uint m); }
'@;Add-Type -TypeDefinition $n;$h=[FixtureClosed]::OpenProcess(0x101000,$false,[uint32]$x.pid);if($h -eq [IntPtr]::Zero){if([string]$x.expectedState -eq 'closed' -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 87){exit 0};throw 'fixture_child_open_failed'};try{[long]$c=0;[long]$e=0;[long]$k=0;[long]$u=0;$s=32768;$name=New-Object Text.StringBuilder $s;if(-not [FixtureClosed]::GetProcessTimes($h,[ref]$c,[ref]$e,[ref]$k,[ref]$u) -or -not [FixtureClosed]::QueryFullProcessImageName($h,0,$name,[ref]$s)){throw 'fixture_child_identity_unavailable'};if($c -ne [Int64]::Parse([string]$x.created) -or -not [string]::Equals($name.ToString(),[string]$x.image,[StringComparison]::OrdinalIgnoreCase)){throw 'fixture_child_identity_changed'};$wait=[FixtureClosed]::WaitForSingleObject($h,0);if(([string]$x.expectedState -eq 'closed' -and $wait -ne 0) -or ([string]$x.expectedState -eq 'running' -and $wait -ne 258)){throw 'fixture_child_state_mismatch'}}finally{[void][FixtureClosed]::CloseHandle($h)}`;
  try {
    execFileSync(systemPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], { windowsHide: true, timeout: 10_000 });
  } catch {
    throw new Error(`fixture child did not prove native ${expectedState} state`);
  }
}

function captureDirectChildren(dataDir: string, phase: "pre" | "post", parentPid: number): void {
  const script = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$p=${parentPid};$children=@(Get-CimInstance Win32_Process -Filter ('ParentProcessId = '+$p) -ErrorAction Stop | ForEach-Object {[PSCustomObject]@{pid=[uint32]$_.ProcessId;parentPid=[uint32]$_.ParentProcessId;name=[string]$_.Name;image=[string]$_.ExecutablePath;creationDate=[string]$_.CreationDate;forkchild=[bool]([string]$_.CommandLine -match '(^|[\\s\"])--forkchild(?:=|\\s|$)')}});[Console]::Out.Write(($children|ConvertTo-Json -Compress))`;
  try {
    const stdout = execFileSync(systemPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], { windowsHide: true, timeout: 10_000, encoding: "utf8" });
    writeFileSync(join(dataDir, `direct-children-${phase}.safe.json`), JSON.stringify(JSON.parse(stdout.trim() || "[]")));
  } catch {
    writeFileSync(join(dataDir, `direct-children-${phase}.safe.json`), JSON.stringify({ captureError: "cim_capture_failed" }));
  }
}

function nativeRunner(dataDir: string): (input: WindowsNativePostgresStopInput) => Promise<WindowsNativePostgresStopResult> {
  return async (input) => {
    captureDirectChildren(dataDir, "pre", input.childPid);
    try {
      const result = await runWindowsNativePostgresStop(input);
      writeFileSync(join(dataDir, "native-result.safe.json"), JSON.stringify({
        closureComplete: result.closureComplete,
        forkChildrenObserved: result.forkChildrenObserved,
        forkChildrenTerminated: result.forkChildrenTerminated,
        pgCtlExitCode: result.pgCtlExitCode,
        pgCtlManagedExitCode: result.pgCtlManagedExitCode,
        pgCtlSucceeded: result.pgCtlSucceeded,
        rootExited: result.rootExited,
        rootExitCode: result.rootExitCode,
        rootIdentityVerified: result.rootIdentityVerified,
        unknownChildren: result.unknownChildren,
        errorCode: result.errorCode ?? null,
      }));
      return result;
    } catch {
      writeFileSync(join(dataDir, "native-result.safe.json"), JSON.stringify({ runnerError: "native_runner_failed" }));
      throw new Error("native fixture runner failed");
    } finally {
      captureDirectChildren(dataDir, "post", input.childPid);
    }
  };
}

async function closeHeldRoot(child: ChildProcess): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return true;
  try { child.kill(); } catch { return false; }
  return await new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), 5_000);
    child.once("exit", () => { clearTimeout(timer); resolveExit(true); });
    child.once("error", () => { clearTimeout(timer); resolveExit(false); });
  });
}

function terminateVerifiedFixtureChild(dataDir: string): boolean {
  const identityPath = join(dataDir, "fixture-child.json");
  if (!existsSync(identityPath)) return true;
  const [pid, image, created] = readFileSync(identityPath, "utf8").split("|");
  const payload = Buffer.from(JSON.stringify({ pid: Number(pid), image, created }), "utf8").toString("base64");
  const script = String.raw`$x=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}'))|ConvertFrom-Json;$n=@'
using System;using System.Runtime.InteropServices;using System.Text;
public static class FixtureCleanup { [DllImport("kernel32.dll",SetLastError=true)]public static extern IntPtr OpenProcess(uint a,bool i,uint p);[DllImport("kernel32.dll")]public static extern bool CloseHandle(IntPtr h);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool GetProcessTimes(IntPtr h,out long c,out long e,out long k,out long u);[DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool QueryFullProcessImageName(IntPtr h,uint f,StringBuilder n,ref uint s);[DllImport("kernel32.dll",SetLastError=true)]public static extern bool TerminateProcess(IntPtr h,uint c);[DllImport("kernel32.dll",SetLastError=true)]public static extern uint WaitForSingleObject(IntPtr h,uint m); }
'@;Add-Type -TypeDefinition $n;$h=[FixtureCleanup]::OpenProcess(0x101001,$false,[uint32]$x.pid);if($h -eq [IntPtr]::Zero){if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -eq 87){exit 0};throw 'fixture_open_failed'};try{$w=[FixtureCleanup]::WaitForSingleObject($h,0);if($w -eq 0){exit 0};if($w -ne 258){throw 'fixture_wait_unavailable'};[long]$c=0;[long]$e=0;[long]$k=0;[long]$u=0;$s=32768;$name=New-Object Text.StringBuilder $s;if(-not [FixtureCleanup]::GetProcessTimes($h,[ref]$c,[ref]$e,[ref]$k,[ref]$u) -or -not [FixtureCleanup]::QueryFullProcessImageName($h,0,$name,[ref]$s)){throw 'fixture_identity_unavailable'};if($c -ne [Int64]::Parse([string]$x.created) -or -not [string]::Equals($name.ToString(),[string]$x.image,[StringComparison]::OrdinalIgnoreCase)){throw 'fixture_identity_changed'};if(-not [FixtureCleanup]::TerminateProcess($h,1) -or [FixtureCleanup]::WaitForSingleObject($h,5000) -ne 0){throw 'fixture_terminate_failed'}}finally{[void][FixtureCleanup]::CloseHandle($h)}`;
  try {
    execFileSync(systemPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(script)], { windowsHide: true, timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function removeOnlyOwnedFixtureRoot(): void {
  const marker = join(root, "fixture.owner");
  if (testFailed || cleanupFailed || !existsSync(root) || !existsSync(marker) || readFileSync(marker, "utf8") !== owner) return;
  const canonicalRoot = realpathSync(root);
  if (dirname(canonicalRoot) !== tempParent || !canonicalRoot.startsWith(`${tempParent}\\paperclip-native-stop-`) || lstatSync(root).isSymbolicLink()) return;
  for (let attempt = 0; attempt < 3 && existsSync(root); attempt++) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 0 }); }
    catch { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); }
  }
}

describe.skipIf(process.platform !== "win32")("stopOwnedEmbeddedPostgresOnWindows native fixture", () => {
  beforeAll(() => {
    writeFileSync(join(root, "fixture.owner"), owner);
    execFileSync(systemPowerShell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encodePowerShell(fixtureCompileCommand(fixtureSource, postgres))], { windowsHide: true, timeout: 30_000 });
    copyFileSync(postgres, pgCtl);
  }, 30_000);

  afterEach(async (context) => {
    if (context.task.result?.state === "fail") testFailed = true;
    for (const child of heldRoots.splice(0)) if (!await closeHeldRoot(child)) cleanupFailed = true;
    for (const name of ["owned", "foreign", "deadline"]) if (!terminateVerifiedFixtureChild(join(root, `${name} 数据目录 with spaces`))) cleanupFailed = true;
    if (cleanupFailed) throw new Error("native fixture cleanup failed; evidence retained");
  });

  it("terminates only the verified suspended --forkchild=fixture after pg_ctl receives the data directory as one argv item", async () => {
    const { child, dataDir } = await launch("owned");
    const instance = { process: child, stop: async () => undefined };
    await stopOwnedEmbeddedPostgresOnWindows({ instance, dataDir, pgCtlPath: pgCtl, runWindowsNativeStop: nativeRunner(dataDir) });
    expect(instance.process).toBeUndefined();
    const nativeResult = JSON.parse(readFileSync(join(dataDir, "native-result.safe.json"), "utf8"));
    expect(nativeResult).toMatchObject({ forkChildrenObserved: 1, forkChildrenTerminated: 1, unknownChildren: 0 });
    assertVerifiedFixtureChildState(dataDir, "closed");
    const args = readFileSync(join(dataDir, "argv.txt"), "utf8").split("\u001f");
    expect(args.slice(0, 7)).toEqual(["-D", dataDir, "stop", "-m", "fast", "-w", "-t"]);
    expect(Number(args[7])).toBeGreaterThanOrEqual(1);
    expect(Number(args[7])).toBeLessThanOrEqual(30);
  }, 60_000);

  it("rejects a direct foreign-image child while detaching the normally exited root and preserving that foreign fixture", async () => {
    const { child, dataDir } = await launch("foreign", true);
    const instance = { process: child, stop: async () => undefined };
    await expect(stopOwnedEmbeddedPostgresOnWindows({ instance, dataDir, pgCtlPath: pgCtl, runWindowsNativeStop: nativeRunner(dataDir) })).rejects.toThrow("did not prove owned process closure");
    const nativeResult = JSON.parse(readFileSync(join(dataDir, "native-result.safe.json"), "utf8"));
    expect(nativeResult).toMatchObject({ rootIdentityVerified: true, pgCtlSucceeded: true, rootExited: true, rootExitCode: 0, closureComplete: false, unknownChildren: 1 });
    assertVerifiedFixtureChildState(dataDir, "running");
    expect(instance.process).toBeUndefined();
  }, 60_000);

  it("does not clear the owned Node child when the shared native deadline elapses", async () => {
    const { child, dataDir } = await launch("deadline");
    const instance = { process: child, stop: async () => undefined };
    await expect(stopOwnedEmbeddedPostgresOnWindows({ instance, dataDir, pgCtlPath: pgCtl, timeoutMs: 1, runWindowsNativeStop: nativeRunner(dataDir) })).rejects.toThrow();
    expect(instance.process).toBe(child);
  }, 30_000);
});

afterAll(removeOnlyOwnedFixtureRoot);
