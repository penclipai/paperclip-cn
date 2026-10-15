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
  const deepStage = buildUninstaller
    ? ""
    : `  CreateDirectory \"$PLUGINSDIR\\old-install\"\n  FileOpen $1 \"$PLUGINSDIR\\old-install\\${deepLeaf}\" w\n  IfErrors deepPathFailure\n  FileWrite $1 \"deep path is writable\"\n  FileClose $1\n  FileWrite $0 \"DEEP_PATH=ok$\\r$\\n\"\n  Goto afterDeepPath\ndeepPathFailure:\n  FileWrite $0 \"DEEP_PATH=failed$\\r$\\n\"\n  FileClose $0\n  SetErrorLevel 36\n  Quit\nafterDeepPath:\n`;
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
  FileOpen $0 "${nsisPath(logFile)}" w
  FileWrite $0 "NSIS_TEMP=$TEMP$\\r$\\n"
  FileWrite $0 "PLUGINSDIR=$PLUGINSDIR$\\r$\\n"
  ReadEnvStr $R0 "TEMP"
  ReadEnvStr $R1 "TMP"
  FileWrite $0 "ENV_TEMP=$R0$\\r$\\n"
  FileWrite $0 "ENV_TMP=$R1$\\r$\\n"
  FileWrite $0 "INSTDIR=$INSTDIR$\\r$\\n"
${deepStage}!ifmacrodef customInstall
  !insertmacro customInstall
!endif
  ReadEnvStr $R0 "TEMP"
  ReadEnvStr $R1 "TMP"
  FileWrite $0 "AFTER_ENV_TEMP=$R0$\\r$\\n"
  FileWrite $0 "AFTER_ENV_TMP=$R1$\\r$\\n"
  FileClose $0
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

async function executeAndRead(probe, temp, tmp = temp) {
  await mkdir(temp, { recursive: true });
  await mkdir(tmp, { recursive: true });
  const result = await run(probe.exeFile, ["/S", `/D=${probe.installDir}`], {
    ...process.env,
    TEMP: temp,
    TMP: tmp,
  });
  assert(result.signal === null, `Probe ${path.basename(probe.exeFile)} was terminated by ${result.signal}.`);
  assert(result.code === 37, `Probe ${path.basename(probe.exeFile)} returned ${result.code}; expected child exit code 37.`);
  const records = parseRecords(await readFile(probe.logFile, "utf8"));
  return { records, temp };
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

const longTemp = longTempPath();
const longTmp = `${longTemp}-tmp`;
const long = await executeAndRead(longProbe, longTemp, longTmp);
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
const short = await executeAndRead(shortProbe, shortTemp);
assert(short.records.DEEP_PATH === "ok", "Short-TEMP probe could not create the staged path.");
assert(samePath(short.records.NSIS_TEMP, shortTemp), "Short-TEMP probe unexpectedly changed the staging TEMP directory.");
assert(samePath(short.records.ENV_TEMP, shortTemp) && samePath(short.records.ENV_TMP, shortTemp), "Short-TEMP environment changed unexpectedly.");
assert(samePath(short.records.AFTER_ENV_TEMP, shortTemp) && samePath(short.records.AFTER_ENV_TMP, shortTemp), "Short-TEMP environment was not preserved after customInstall.");

const bypassTemp = longTempPath().replace("long inherited temp", "uninstaller inherited temp");
const bypass = await executeAndRead(uninstallerProbe, bypassTemp);
assert(samePath(bypass.records.NSIS_TEMP, bypassTemp), "BUILD_UNINSTALLER incorrectly entered the installer bootstrap path.");
assert(samePath(bypass.records.ENV_TEMP, bypassTemp) && samePath(bypass.records.ENV_TMP, bypassTemp), "BUILD_UNINSTALLER changed inherited TEMP/TMP.");

// The hook must fail before the first System plug-in load when the inherited
// location is too long even for that bootstrapper. That turns an otherwise
// silent NSIS plug-in failure into a deterministic non-zero installer result.
const extremeTemp = longTempPath(201);
await mkdir(extremeTemp, { recursive: true });
const extremeResult = await run(extremeProbe.exeFile, ["/S", `/D=${extremeProbe.installDir}`], {
  ...process.env,
  TEMP: extremeTemp,
  TMP: extremeTemp,
});
assert(extremeResult.signal === null && extremeResult.code === 1603, `201-character TEMP returned ${extremeResult.code}; expected 1603 before section execution.`);
assert(!existsSync(extremeProbe.logFile), "201-character TEMP reached the installer section instead of failing during preInit.");

const summary = {
  evidenceDir,
  deepRelativeLength,
  long: { inheritedTemp: longTemp, records: long.records },
  short: { inheritedTemp: shortTemp, records: short.records },
  buildUninstaller: { inheritedTemp: bypassTemp, records: bypass.records },
  extreme: { inheritedTemp: extremeTemp, result: extremeResult, sectionRecordsPresent: existsSync(extremeProbe.logFile) },
};
await writeFile(path.join(evidenceDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
