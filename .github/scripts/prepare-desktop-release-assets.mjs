import { createHash } from "node:crypto";
import { cpSync, createReadStream, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const expectedTargets = [
  { artifact: "win-x64", platform: "win", arch: "x64", filenameArch: "x64", suffix: ".exe" },
  { artifact: "mac-x64", platform: "mac", arch: "x64", filenameArch: "x64", suffix: ".dmg" },
  { artifact: "mac-arm64", platform: "mac", arch: "arm64", filenameArch: "arm64", suffix: ".dmg" },
  { artifact: "linux-x64", platform: "linux", arch: "x64", filenameArch: "x86_64", suffix: ".AppImage" },
];

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (!option.startsWith("--") || !argv[index + 1]) throw new Error("Usage: prepare-desktop-release-assets.mjs --bundles-dir <path> --output-dir <path> --release-version <version> --artifact-prefix <name>");
    options[option.slice(2)] = argv[++index];
  }
  for (const required of ["bundles-dir", "output-dir", "release-version", "artifact-prefix"]) {
    if (!options[required]) throw new Error(`Missing --${required}.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options["release-version"])) throw new Error("Unsafe release version.");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(options["artifact-prefix"])) throw new Error("Unsafe artifact prefix.");
  return options;
}

function safeBasename(value) {
  if (typeof value !== "string" || value.length === 0) throw new Error("Manifest release asset path must be a non-empty string.");
  const normalized = value.replaceAll("\\", "/");
  const base = path.posix.basename(normalized);
  if (base !== normalized.split("/").at(-1) || !base || base === "." || base === ".." || base.includes("/")) {
    throw new Error(`Unsafe manifest release asset path: ${value}`);
  }
  return base;
}

function findFiles(root, name) {
  const matches = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link in downloaded artifact: ${entryPath}`);
    if (entry.isDirectory()) matches.push(...findFiles(entryPath, name));
    else if (entry.isFile() && entry.name === name) matches.push(entryPath);
  }
  return matches;
}

function exactlyOne(root, name, label) {
  const matches = findFiles(root, name);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${label} named ${name} in ${root}, found ${matches.length}.`);
  return matches[0];
}

function containedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const bundlesDir = path.resolve(options["bundles-dir"]);
  if (!existsSync(bundlesDir) || lstatSync(bundlesDir).isSymbolicLink() || !statSync(bundlesDir).isDirectory()) throw new Error(`Invalid bundles directory: ${bundlesDir}`);
  const bundlesRoot = realpathSync(bundlesDir);
  const outputDir = path.resolve(options["output-dir"]);
  if (existsSync(outputDir)) throw new Error(`Output directory already exists: ${outputDir}`);
  mkdirSync(outputDir, { recursive: true });
  const checksums = [];

  for (const target of expectedTargets) {
    const bundleDir = path.resolve(bundlesRoot, `${options["artifact-prefix"]}-${target.artifact}`);
    if (!containedPath(bundlesRoot, bundleDir) || !existsSync(bundleDir) || lstatSync(bundleDir).isSymbolicLink() || !statSync(bundleDir).isDirectory()) throw new Error(`Missing downloaded bundle: ${bundleDir}`);
    if (!containedPath(bundlesRoot, realpathSync(bundleDir))) throw new Error(`Downloaded bundle resolves outside configured root: ${bundleDir}`);
    const manifestPath = exactlyOne(bundleDir, "desktop-artifacts.json", "manifest");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (manifest.platform !== target.platform || manifest.arch !== target.arch) {
      throw new Error(`Unexpected manifest target in ${manifestPath}: expected ${target.platform}/${target.arch}.`);
    }
    if (manifest.releaseVersion !== options["release-version"]) throw new Error(`Unexpected release version in ${manifestPath}.`);
    if (!Array.isArray(manifest.releaseAssetPaths) || manifest.releaseAssetPaths.length !== 1) throw new Error(`Expected exactly one release asset in ${manifestPath}.`);

    const assetName = safeBasename(manifest.releaseAssetPaths[0]);
    const expectedName = `Paperclip-CN-${options["release-version"]}-${target.filenameArch}${target.suffix}`;
    if (assetName !== expectedName) throw new Error(`Unexpected installer name in ${manifestPath}: expected ${expectedName}.`);
    const source = exactlyOne(bundleDir, assetName, "installer");
    if (statSync(source).size === 0) throw new Error(`Installer is empty: ${source}`);
    const destination = path.join(outputDir, assetName);
    if (existsSync(destination)) throw new Error(`Duplicate desktop installer name: ${assetName}`);
    cpSync(source, destination, { errorOnExist: true });
    checksums.push(`${await sha256(destination)}  ${assetName}`);
  }

  if (checksums.length !== 4) throw new Error(`Expected exactly four desktop installers, found ${checksums.length}.`);
  writeFileSync(path.join(outputDir, "SHA256SUMS.txt"), `${checksums.sort().join("\n")}\n`, "utf8");
}

await main();
