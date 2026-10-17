#!/usr/bin/env node

/**
 * Compile and execute a minimal NSIS installer against assets/installer.nsh.
 *
 * This is deliberately an integration probe: NSIS caches $TEMP before .onInit,
 * so a unit test cannot prove that a bootstrapper actually gives 7z extraction
 * and the upgrade uninstaller a usable short staging path.
 *
 * Usage:
 *   node scripts/test-nsis-temp.mjs --makensis D:\\...\\makensis.exe --work-dir D:\\...\\evidence
 */
import { existsSync } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const args = process.argv.slice(2);

function option(name) {
  const index = args.indexOf(name);
  if (index === -1 || !args[index + 1]) {
    throw new Error(`Missing required ${name} argument.`);
  }
  return args[index + 1];
}

function nsisPath(value) {
  return value.replaceAll("/", "\\").replaceAll('"', '$\\"');
}

function parseRecords(contents) {
  return Object.fromEntries(
    contents
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((entry) => {
        const separator = entry.indexOf("=");
        return [entry.slice(0, separator), entry.slice(separator + 1)];
      }),
  );
}

function samePath(left, right) {
  const normalize = (value) => path.win32.normalize(value).replace(/[\\/]+$/u, "").toLowerCase();
  return normalize(left) === normalize(right);
}

function environmentState(environment, name) {
  const entry = Object.entries(environment).find(([key]) => key.toUpperCase() === name);
  if (entry === undefined) return { state: "missing" };
  return entry[1] === "" ? { state: "empty" } : { state: "value", value: entry[1] };
}

function setEnvironmentValue(environment, name, value) {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === name) delete environment[key];
  }
  if (value !== undefined) environment[name] = value;
}

function nativeEnvironmentRecord(name, label) {
  return `  System::Call 'kernel32::SetLastError(i 0)'
  System::Call 'kernel32::GetEnvironmentVariableW(w "${name}", p 0, i 0) i.r2 ?e'
  Pop $R3
  FileWrite $9 "${label}_RETURN=$2$\\r$\\n"
  FileWrite $9 "${label}_ERROR=$R3$\\r$\\n"
  ${"${If}"} $2 == 0
    ${"${If}"} $R3 == 203
      FileWrite $9 "${label}=missing$\\r$\\n"
    ${"${Else}"}
      FileWrite $9 "${label}=empty$\\r$\\n"
    ${"${EndIf}"}
  ${"${Else}"}
    FileWrite $9 "${label}=value$\\r$\\n"
  ${"${EndIf}"}
`;
}

function run(executable, commandArgs, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, commandArgs, {
      cwd: path.dirname(executable),
      env: environment,
      stdio: "ignore",
      windowsHide: true,
      // NSIS consumes /D from the raw command line. Its documented contract is
      // a final, unquoted /D= path, including a path that contains spaces.
      windowsVerbatimArguments: true,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const makensis = path.resolve(option("--makensis"));
const workDir = path.resolve(option("--work-dir"));
assert(process.platform === "win32", "This integration probe requires Windows.");
const tempDrive = path.parse(workDir).root;
assert(/^[a-z]:\\$/iu.test(tempDrive), "--work-dir must be on a local drive.");
await access(makensis);
await mkdir(workDir, { recursive: true });

const hook = fileURLToPath(new URL("../assets/installer.nsh", import.meta.url));
assert(existsSync(hook), `Missing NSIS hook: ${hook}`);

const nonce = `${new Date().toISOString().replaceAll(/[:.]/gu, "-")}-${process.pid}`;
const evidenceDir = path.join(workDir, `nsis-temp-harness-${nonce}`);
await mkdir(evidenceDir, { recursive: false });

// The 219-character payload entry matches the longest shipped archive relative
// path.  Adding old-install and NSIS' private plug-in directory exceeds MAX_PATH
// under the deliberately long inherited TEMP below.
const deepLeaf = "d".repeat(219);
const deepRelativeLength = deepLeaf.length;

function probeSource({ name, buildUninstaller }) {
  const logFile = path.join(evidenceDir, `${name}.records`);
  const exeFile = path.join(evidenceDir, `${name}.exe`);
  const installDir = path.join(evidenceDir, "install override with spaces", name);
  const defaultInstallDir = path.join(evidenceDir, "default install directory", name);
  const define = buildUninstaller ? "!define BUILD_UNINSTALLER\n" : "";
  const initialEnvironment = `${nativeEnvironmentRecord("TEMP", "ENV_TEMP_STATE")}${nativeEnvironmentRecord("TMP", "ENV_TMP_STATE")}`;
  const finalEnvironment = `${nativeEnvironmentRecord("TEMP", "AFTER_ENV_TEMP_STATE")}${nativeEnvironmentRecord("TMP", "AFTER_ENV_TMP_STATE")}${nativeEnvironmentRecord("PAPERCLIP_NSIS_TEMP_ROOT", "AFTER_MARKER_TEMP_ROOT_STATE")}${nativeEnvironmentRecord("PAPERCLIP_NSIS_ORIGINAL_TEMP", "AFTER_MARKER_ORIGINAL_TEMP_STATE")}${nativeEnvironmentRecord("PAPERCLIP_NSIS_ORIGINAL_TMP", "AFTER_MARKER_ORIGINAL_TMP_STATE")}`;
  const deepStage = buildUninstaller
    ? ""
    : `  ClearErrors\n  CreateDirectory \"$PLUGINSDIR\\old-install\"\n  IfErrors deepDirectoryFailure\n  FileWrite $9 \"DEEP_DIRECTORY=created$\\r$\\n\"\n  ClearErrors\n  FileOpen $1 \"$PLUGINSDIR\\old-install\\${deepLeaf}\" w\n  IfErrors deepPathFailure\n  FileWrite $1 \"deep path is writable\"\n  FileClose $1\n  IfErrors deepPathFailure\n  IfFileExists \"$PLUGINSDIR\\old-install\\${deepLeaf}\" 0 deepPathFailure\n  FileOpen $1 \"$PLUGINSDIR\\old-install\\${deepLeaf}\" r\n  IfErrors deepPathFailure\n  FileSeek $1 0 END $R4\n  FileClose $1\n  IfErrors deepPathFailure\n  FileWrite $9 \"DEEP_PATH=ok$\\r$\\n\"\n  FileWrite $9 \"DEEP_PATH_BYTES=$R4$\\r$\\n\"\n  Goto afterDeepPath\ndeepDirectoryFailure:\n  System::Call 'kernel32::GetLastError() i.r2'\n  FileWrite $9 \"DEEP_DIRECTORY=failed:$2$\\r$\\n\"\n  Goto deepPathFailure\ndeepPathFailure:\n  System::Call 'kernel32::GetLastError() i.r2'\n  FileWrite $9 \"DEEP_PATH=failed:$2$\\r$\\n\"\n  FileClose $9\n  SetErrorLevel 36\n  Quit\nafterDeepPath:\n`;
  return {
    exeFile,
    logFile,
    installDir,
    source: `Unicode true
RequestExecutionLevel user
SilentInstall silent
ShowInstDetails nevershow
Name "Paperclip NSIS TEMP probe"
OutFile "${nsisPath(exeFile)}"
InstallDir "${nsisPath(defaultInstallDir)}"
${define}!include "${nsisPath(hook)}"

Function .onInit
!ifmacrodef preInit
  !insertmacro preInit
!endif
FunctionEnd

Section
  InitPluginsDir
  FileOpen $9 "${nsisPath(logFile)}" w
  FileWrite $9 "NSIS_TEMP=$TEMP$\\r$\\n"
  FileWrite $9 "PLUGINSDIR=$PLUGINSDIR$\\r$\\n"
  ReadEnvStr $R0 "TEMP"
  ReadEnvStr $R1 "TMP"
  ReadEnvStr $R4 "USERPROFILE"
  FileWrite $9 "ENV_TEMP=$R0$\\r$\\n"
  FileWrite $9 "ENV_TMP=$R1$\\r$\\n"
  FileWrite $9 "ENV_USERPROFILE=$R4$\\r$\\n"
${initialEnvironment}  FileWrite $9 "INSTDIR=$INSTDIR$\\r$\\n"
${deepStage}!ifmacrodef customInstall
  !insertmacro customInstall
!endif
  ReadEnvStr $R0 "TEMP"
  ReadEnvStr $R1 "TMP"
  ReadEnvStr $R4 "USERPROFILE"
  FileWrite $9 "AFTER_ENV_TEMP=$R0$\\r$\\n"
  FileWrite $9 "AFTER_ENV_TMP=$R1$\\r$\\n"
  FileWrite $9 "AFTER_ENV_USERPROFILE=$R4$\\r$\\n"
${finalEnvironment}  FileClose $9
  SetErrorLevel 37
SectionEnd
`,
  };
}

function compile(name, buildUninstaller) {
  const probe = probeSource({ name, buildUninstaller });
  const sourceFile = path.join(evidenceDir, `${name}.nsi`);
  return writeFile(sourceFile, probe.source, "utf8").then(() => {
    const compiled = spawnSync(makensis, ["/V2", sourceFile], {
      cwd: evidenceDir,
      env: { ...process.env, TEMP: evidenceDir, TMP: evidenceDir, TMPDIR: evidenceDir },
      encoding: "utf8",
      windowsHide: true,
    });
    return writeFile(path.join(evidenceDir, `${name}.compile.log`), `${compiled.stdout}\n${compiled.stderr}`, "utf8").then(() => {
      if (compiled.status !== 0) {
        throw new Error(`makensis failed for ${name} (${compiled.status}):\n${compiled.stdout}\n${compiled.stderr}`);
      }
      return probe;
    });
  });
}

function longTempPath(targetLength = 145) {
  const prefix = path.join(evidenceDir, "long inherited temp");
  const remaining = Math.max(0, targetLength - prefix.length - 1);
  return path.join(prefix, "t".repeat(remaining));
}

async function driveTempPath(length) {
  const nameLength = length - tempDrive.length;
  assert(nameLength >= 10, `TEMP path length ${length} is too short for a unique D-drive probe directory.`);
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const prefix = `pc${randomBytes(4).toString("hex")}`;
    const candidate = path.join(tempDrive, `${prefix}${"t".repeat(nameLength - prefix.length)}`);
    assert(candidate.length === length, `Generated TEMP path has length ${candidate.length}; expected ${length}.`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error(`Could not allocate a unique ${length}-character TEMP directory on the evidence drive.`);
}

async function prepareEnvironmentDirectories(overrides) {
  for (const name of ["TEMP", "TMP", "LOCALAPPDATA", "APPDATA", "USERPROFILE"]) {
    const value = overrides[name];
    if (typeof value === "string" && value !== "") await mkdir(value, { recursive: true });
  }
}

function environmentWith(overrides) {
  const environment = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    setEnvironmentValue(environment, name, value);
  }
  return environment;
}

function getNativeTempPath(environment) {
  const script = [
    'Add-Type -TypeDefinition @\'',
    'using System;',
    'using System.Runtime.InteropServices;',
    'using System.Text;',
    'public static class PaperclipNativeTemp {',
    '  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]',
    '  public static extern uint GetTempPath(uint bufferLength, StringBuilder buffer);',
    '}',
    '\'@',
    '$buffer = [System.Text.StringBuilder]::new(32768)',
    '$length = [PaperclipNativeTemp]::GetTempPath([uint32]$buffer.Capacity, $buffer)',
    'if ($length -eq 0 -or $length -ge $buffer.Capacity) { exit 1 }',
    '[Console]::Out.Write($buffer.ToString())',
  ].join("\n");
  const result = spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], {
    env: environment,
    encoding: "utf8",
    windowsHide: true,
  });
  assert(result.status === 0, `GetTempPathW preflight failed (${result.status}): ${result.stderr}`);
  return result.stdout.trim();
}

async function executeAndRead(probe, overrides) {
  await prepareEnvironmentDirectories(overrides);
  const environment = environmentWith(overrides);
  const result = await run(probe.exeFile, ["/S", `/D=${probe.installDir}`], environment);
  assert(result.signal === null, `Probe ${path.basename(probe.exeFile)} was terminated by ${result.signal}.`);
  assert(result.code === 37, `Probe ${path.basename(probe.exeFile)} returned ${result.code}; expected child exit code 37.`);
  const records = parseRecords(await readFile(probe.logFile, "utf8"));
  return {
    records,
    inputEnvironment: Object.fromEntries(["TEMP", "TMP", "TMPDIR", "LOCALAPPDATA", "APPDATA", "USERPROFILE"].map((name) => [name, environmentState(environment, name)])),
  };
}

async function shortTempPath() {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = path.join(tempDrive, `t${randomBytes(4).toString("hex")}`);
    try {
      await mkdir(candidate);
      return candidate;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  throw new Error("Could not allocate a unique short TEMP directory on the evidence drive.");
}

const longProbe = await compile("long-temp", false);
const shortProbe = await compile("short-temp", false);
const uninstallerProbe = await compile("build-uninstaller", true);
const extremeProbe = await compile("extreme-temp", false);
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const longTemp = longTempPath();
const longTmp = `${longTemp}-tmp`;
const long = await executeAndRead(longProbe, { TEMP: longTemp, TMP: longTmp });
assert(long.records.DEEP_PATH === "ok", "Long-TEMP probe could not create the 219-character staged path.");
assert(samePath(long.records.INSTDIR, longProbe.installDir), "/D install directory with spaces was not preserved.");
assert(!samePath(long.records.NSIS_TEMP, longTemp), "Long-TEMP probe did not bootstrap into a private short TEMP directory.");
assert(samePath(long.records.ENV_TEMP, long.records.NSIS_TEMP), "Child TEMP environment does not match NSIS $TEMP.");
assert(samePath(long.records.ENV_TMP, long.records.NSIS_TEMP), "Child TMP environment does not match NSIS $TEMP.");
assert(samePath(long.records.AFTER_ENV_TEMP, longTemp), "customInstall did not restore inherited TEMP before app launch.");
assert(samePath(long.records.AFTER_ENV_TMP, longTmp), "customInstall did not restore inherited TMP before app launch.");
assert(path.parse(long.records.NSIS_TEMP).root.toLowerCase() === tempDrive.toLowerCase(), "Bootstrap moved TEMP to another drive.");
assert(!existsSync(long.records.NSIS_TEMP), "Bootstrap private TEMP directory was not cleaned after child exit.");

const shortTemp = await shortTempPath();
const short = await executeAndRead(shortProbe, { TEMP: shortTemp, TMP: shortTemp });
assert(short.records.DEEP_PATH === "ok", "Short-TEMP probe could not create the staged path.");
assert(samePath(short.records.NSIS_TEMP, shortTemp), "Short-TEMP probe unexpectedly changed the staging TEMP directory.");
assert(samePath(short.records.ENV_TEMP, shortTemp) && samePath(short.records.ENV_TMP, shortTemp), "Short-TEMP environment changed unexpectedly.");
assert(samePath(short.records.AFTER_ENV_TEMP, shortTemp) && samePath(short.records.AFTER_ENV_TMP, shortTemp), "Short-TEMP environment was not preserved after customInstall.");

const bypassTemp = longTempPath().replace("long inherited temp", "uninstaller inherited temp");
const bypass = await executeAndRead(uninstallerProbe, { TEMP: bypassTemp, TMP: bypassTemp });
assert(samePath(bypass.records.NSIS_TEMP, bypassTemp), "BUILD_UNINSTALLER incorrectly entered the installer bootstrap path.");
assert(samePath(bypass.records.ENV_TEMP, bypassTemp) && samePath(bypass.records.ENV_TMP, bypassTemp), "BUILD_UNINSTALLER changed inherited TEMP/TMP.");

const tempOnly = longTempPath().replace("long inherited temp", "temp-only inherited temp");
const tmpUnset = await executeAndRead(longProbe, { TEMP: tempOnly, TMP: undefined });
expect(tmpUnset.inputEnvironment.TMP.state === "missing", "TMP-unset probe did not remove TMP from the child environment.");
expect(tmpUnset.records.DEEP_PATH === "ok" && !samePath(tmpUnset.records.NSIS_TEMP, tempOnly), "TMP-unset/TEMP-long probe did not bootstrap a usable short TEMP.");
expect(tmpUnset.records.AFTER_ENV_TEMP_STATE === "value" && samePath(tmpUnset.records.AFTER_ENV_TEMP, tempOnly), "TMP-unset probe did not restore TEMP.");
expect(tmpUnset.records.AFTER_ENV_TMP_STATE === "missing", "TMP-unset probe restored TMP as an empty value instead of removing it.");
expect(!existsSync(tmpUnset.records.NSIS_TEMP), "TMP-unset probe did not clean its private D-drive TEMP root.");

const tempExplicitEmptyTmp = longTempPath().replace("long inherited temp", "empty-temp inherited tmp");
const tempExplicitEmptyProfile = path.join(evidenceDir, "empty-temp user profile");
const tempExplicitEmptyOverrides = {
  TEMP: "",
  TMP: tempExplicitEmptyTmp,
  TMPDIR: undefined,
  LOCALAPPDATA: path.join(tempExplicitEmptyProfile, "local-app-data"),
  APPDATA: path.join(tempExplicitEmptyProfile, "app-data"),
  USERPROFILE: tempExplicitEmptyProfile,
};
await prepareEnvironmentDirectories(tempExplicitEmptyOverrides);
const tempExplicitEmptyNativeTemp = getNativeTempPath(environmentWith(tempExplicitEmptyOverrides));
assert(path.parse(tempExplicitEmptyNativeTemp).root.toLowerCase() === tempDrive.toLowerCase(), `Explicit-empty TEMP preflight resolved GetTempPathW to ${tempExplicitEmptyNativeTemp}, outside the D evidence drive.`);
const tempExplicitEmpty = await executeAndRead(longProbe, {
  ...tempExplicitEmptyOverrides,
});
expect(tempExplicitEmpty.inputEnvironment.TEMP.state === "empty", "Explicit-empty TEMP probe did not retain an empty TEMP input.");
expect(tempExplicitEmpty.records.DEEP_PATH === "ok" && path.parse(tempExplicitEmpty.records.NSIS_TEMP).root.toLowerCase() === tempDrive.toLowerCase(), "Explicit-empty TEMP was not treated as unset for its D-drive TMP fallback.");
expect(tempExplicitEmpty.records.AFTER_ENV_TEMP_STATE === "missing", "Explicit-empty TEMP was not restored as unset.");
expect(tempExplicitEmpty.records.AFTER_ENV_TMP_STATE === "value" && samePath(tempExplicitEmpty.records.AFTER_ENV_TMP, tempExplicitEmptyTmp), "Explicit-empty TEMP probe did not restore TMP.");
expect(!existsSync(tempExplicitEmpty.records.NSIS_TEMP), "Explicit-empty TEMP probe did not clean its private D-drive TEMP root.");

const restoreTempRoot = await driveTempPath(13);
const restoreEmptyOverrides = {
  TEMP: restoreTempRoot,
  TMP: restoreTempRoot,
  TMPDIR: undefined,
  PAPERCLIP_NSIS_TEMP_ROOT: restoreTempRoot,
  PAPERCLIP_NSIS_ORIGINAL_TEMP: "",
  PAPERCLIP_NSIS_ORIGINAL_TMP: "",
};
const restoreEmpty = await executeAndRead(shortProbe, restoreEmptyOverrides);
expect(restoreEmpty.records.AFTER_ENV_TEMP_STATE === "missing" && restoreEmpty.records.AFTER_ENV_TMP_STATE === "missing", "Controlled short-child restore probe did not remove empty original TEMP/TMP values.");
expect(restoreEmpty.records.AFTER_MARKER_TEMP_ROOT_STATE === "missing" && restoreEmpty.records.AFTER_MARKER_ORIGINAL_TEMP_STATE === "missing" && restoreEmpty.records.AFTER_MARKER_ORIGINAL_TMP_STATE === "missing", "Controlled short-child restore probe did not clear temporary environment markers.");

const skipped = {
  tempUnset: "not run: no complete-startup native GetTempPathW preflight for a missing TEMP combination",
  bothUnset: "not run: no complete-startup native GetTempPathW preflight for both missing values",
  tmpExplicitEmpty: "not run: no complete-startup native GetTempPathW preflight for an empty TMP combination",
};

const temp14 = await driveTempPath(14);
const boundary14 = await executeAndRead(longProbe, { TEMP: temp14, TMP: temp14 });
expect(temp14.length === 14 && !samePath(boundary14.records.NSIS_TEMP, temp14), "14-character TEMP did not take the short-staging bootstrap path.");
expect(boundary14.records.AFTER_ENV_TEMP_STATE === "value" && samePath(boundary14.records.AFTER_ENV_TEMP, temp14), "14-character TEMP was not restored.");
expect(!existsSync(boundary14.records.NSIS_TEMP), "14-character TEMP probe did not clean its private D-drive TEMP root.");

const temp200 = await driveTempPath(200);
const boundary200 = await executeAndRead(longProbe, { TEMP: temp200, TMP: temp200 });
expect(temp200.length === 200 && boundary200.records.DEEP_PATH === "ok", "200-character TEMP did not complete the deep staging probe.");
expect(!samePath(boundary200.records.NSIS_TEMP, temp200), "200-character TEMP did not bootstrap a private short staging path.");
expect(boundary200.records.AFTER_ENV_TEMP_STATE === "value" && samePath(boundary200.records.AFTER_ENV_TEMP, temp200), "200-character TEMP was not restored.");
expect(!existsSync(boundary200.records.NSIS_TEMP), "200-character TEMP probe did not clean its private D-drive TEMP root.");

// The hook must fail before the first System plug-in load when the inherited
// location is too long even for that bootstrapper. That turns an otherwise
// silent NSIS plug-in failure into a deterministic non-zero installer result.
const extremeTemp = longTempPath(201);
await mkdir(extremeTemp, { recursive: true });
const extremeResult = await run(extremeProbe.exeFile, ["/S", `/D=${extremeProbe.installDir}`], environmentWith({ TEMP: extremeTemp, TMP: extremeTemp }));
assert(extremeTemp.length === 201, `Extreme TEMP has length ${extremeTemp.length}; expected 201.`);
assert(extremeResult.signal === null && extremeResult.code === 1603, `201-character TEMP returned ${extremeResult.code}; expected 1603 before section execution.`);
assert(!existsSync(extremeProbe.logFile), "201-character TEMP reached the installer section instead of failing during preInit.");

const summary = {
  evidenceDir,
  deepRelativeLength,
  long: { inheritedTemp: longTemp, records: long.records },
  short: { inheritedTemp: shortTemp, records: short.records },
  buildUninstaller: { inheritedTemp: bypassTemp, records: bypass.records },
  tmpUnset: { inheritedTemp: tempOnly, ...tmpUnset },
  tempExplicitEmpty: { inheritedTmp: tempExplicitEmptyTmp, nativeTempPath: tempExplicitEmptyNativeTemp, ...tempExplicitEmpty },
  restoreEmpty: {
    mode: "restore-contract-controlled-short-child",
    inheritedTempRoot: restoreTempRoot,
    markerInput: Object.fromEntries(["PAPERCLIP_NSIS_TEMP_ROOT", "PAPERCLIP_NSIS_ORIGINAL_TEMP", "PAPERCLIP_NSIS_ORIGINAL_TMP"].map((name) => [name, environmentState(environmentWith(restoreEmptyOverrides), name)])),
    ...restoreEmpty,
  },
  boundary14: { inheritedTemp: temp14, ...boundary14 },
  boundary200: { inheritedTemp: temp200, ...boundary200 },
  extreme: { inheritedTemp: extremeTemp, result: extremeResult, sectionRecordsPresent: existsSync(extremeProbe.logFile) },
  skipped,
  failures,
};
await writeFile(path.join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (failures.length > 0) {
  throw new Error(`NSIS TEMP boundary regressions:\n- ${failures.join("\n- ")}`);
}
