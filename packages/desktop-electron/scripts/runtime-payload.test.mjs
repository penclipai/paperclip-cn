import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, test } from "node:test";
import { readFileSync } from "node:fs";
import { inspectRuntimePayload, optimizeRuntimePayload, pruneVerifiedCopilotMaterializer, runtimePayloadInternals } from "./runtime-payload.mjs";

const VERSION = "1.18.34";
const roots = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const selectedByTarget = {
  "linux-x64": "opencode-linux-x64-baseline",
  "darwin-x64": "opencode-darwin-x64-baseline",
  "darwin-arm64": "opencode-darwin-arm64",
};
const allNativePackages = [
  "opencode-darwin-arm64",
  "opencode-darwin-x64",
  "opencode-darwin-x64-baseline",
  "opencode-linux-arm64",
  "opencode-linux-arm64-musl",
  "opencode-linux-x64",
  "opencode-linux-x64-baseline",
  "opencode-linux-x64-baseline-musl",
  "opencode-linux-x64-musl",
];

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function writePackage(root, name, platform, arch, options = {}) {
  const packageRoot = join(root, "node_modules", name);
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    JSON.stringify({
      name: options.manifestName ?? name,
      version: options.version ?? VERSION,
      os: [platform],
      cpu: [arch],
    }),
  );
  await writeFile(join(packageRoot, "bin", "opencode"), options.payload ?? `#!/bin/sh\necho ${VERSION}\n`);
  await chmod(join(packageRoot, "bin", "opencode"), 0o755);
  return packageRoot;
}

async function fixture({ platform = "linux", arch = "x64", portablePayload, selectedVersion, selectedManifestName, wrapperVersion } = {}) {
  const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-"));
  roots.push(root);
  const native = selectedByTarget[`${platform}-${arch}`];
  const nodeModules = join(root, "node_modules");
  await mkdir(join(nodeModules, "opencode-ai", "bin"), { recursive: true });
  await writeFile(
    join(nodeModules, "opencode-ai", "package.json"),
    JSON.stringify({
      name: "opencode-ai",
      version: wrapperVersion ?? VERSION,
      optionalDependencies: { [native]: VERSION },
    }),
  );
  const selected = await writePackage(root, native, platform, arch, {
    version: selectedVersion,
    manifestName: selectedManifestName,
  });
  const source = join(selected, "bin", "opencode");
  const portable = join(nodeModules, "opencode-ai", "bin", "opencode.exe");
  await writeFile(portable, portablePayload ?? await readFile(source));
  await chmod(portable, 0o755);
  return { root, nodeModules, native, selected, source, portable };
}

async function pnpmFixture() {
  const setup = await fixture();
  const wrapperStore = join(setup.nodeModules, ".pnpm", `opencode-ai@${VERSION}`, "node_modules", "opencode-ai");
  const nativeStore = join(setup.nodeModules, ".pnpm", `${setup.native}@${VERSION}`, "node_modules", setup.native);
  await mkdir(dirname(wrapperStore), { recursive: true });
  await mkdir(dirname(nativeStore), { recursive: true });
  await rename(join(setup.nodeModules, "opencode-ai"), wrapperStore);
  await rename(join(setup.nodeModules, setup.native), nativeStore);
  await symlink(wrapperStore, join(setup.nodeModules, "opencode-ai"), "dir");
  await symlink(nativeStore, join(setup.nodeModules, setup.native), "dir");
  return {
    ...setup,
    wrapperStore,
    nativeStore,
    source: join(nativeStore, "bin", "opencode"),
    portable: join(wrapperStore, "bin", "opencode.exe"),
  };
}

async function writeCopilotMaterializer(root, name) {
  const packageRoot = join(root, "node_modules", name);
  await mkdir(packageRoot, { recursive: true });
  await writeFile(join(packageRoot, "package.json"), JSON.stringify({ name, version: "1.0.88" }));
  await writeFile(join(packageRoot, "copilot"), "materializer input");
  return packageRoot;
}

async function pnpmCopilotMaterializerFixture(root, name) {
  const topLevel = await writeCopilotMaterializer(root, name);
  const store = join(root, "node_modules", ".pnpm", `${name.replace("/", "+")}@1.0.88`, "node_modules", name);
  await mkdir(dirname(store), { recursive: true });
  await rename(topLevel, store);
  await symlink(store, topLevel, "dir");
  const alternateAlias = join(root, "node_modules", ".pnpm", `${name.replace("/", "+")}@1.0.88_peer@fixture`, "node_modules", name);
  await mkdir(dirname(alternateAlias), { recursive: true });
  await symlink(store, alternateAlias, "dir");
  return { topLevel, store, alternateAlias };
}

test("optimizes the selected OpenCode package for all supported Unix targets", async () => {
  for (const [platform, arch] of [["linux", "x64"], ["darwin", "x64"], ["darwin", "arm64"]]) {
    const setup = await fixture({ platform, arch });
    const variants = await Promise.all(
      allNativePackages
        .filter((name) => name !== setup.native)
        .map((name) => writePackage(setup.root, name, platform, arch)),
    );

    const result = optimizeRuntimePayload({ runtimeRoot: setup.root, platform, arch, ...(platform === "linux" ? { libc: "glibc" } : {}) });
    assert.equal(result.supported, true);
    assert.equal(result.nativePackage, setup.native);
    assert.equal(result.portableIsSymlink, true);
    assert.equal(await readlink(setup.portable), relative(dirname(setup.portable), setup.source));
    assert.equal(await readFile(setup.portable, "utf8"), await readFile(setup.source, "utf8"));
    await Promise.all(variants.map((variant) => assert.rejects(lstat(variant))));
    assert.ok(result.bytesSaved > 0);
    assert.deepEqual(result.unexpectedPackages, []);
  }
});

test("preserves Windows and reports it as unsupported", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-win-"));
  roots.push(root);
  const result = optimizeRuntimePayload({ runtimeRoot: root, platform: "win32", arch: "x64" });
  assert.deepEqual(result, {
    supported: false,
    platform: "win32",
    arch: "x64",
    nativePackage: null,
    nativeExecutable: null,
    portableExecutable: null,
    portableIsSymlink: false,
    unexpectedPackages: [],
    bytesSaved: 0,
  });
});

test("prunes only the verified target Copilot materializer after provider assets are retained", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-copilot-"));
  roots.push(root);
  const selected = await pnpmCopilotMaterializerFixture(root, "@github/copilot-darwin-arm64");
  const wrongTarget = await writeCopilotMaterializer(root, "@github/copilot-darwin-x64");
  const unrelated = await writeCopilotMaterializer(root, "@github/not-copilot");
  const assets = join(root, "server", "provider-assets", "copilot", "darwin-arm64");
  await mkdir(join(assets, "distribution"), { recursive: true });
  await writeFile(join(assets, ".paperclip-copilot-closure.json"), "verified closure");
  await writeFile(join(assets, "copilot"), "verified executable");
  await writeFile(join(assets, "distribution", "messages.json"), "verified distribution");

  const result = pruneVerifiedCopilotMaterializer({ runtimeRoot: root, platform: "darwin", arch: "arm64" });
  assert.deepEqual(result, {
    supported: true,
    platform: "darwin",
    arch: "arm64",
    packageName: "@github/copilot-darwin-arm64",
    bytesSaved: result.bytesSaved,
  });
  assert.ok(result.bytesSaved > 0);
  await assert.rejects(lstat(selected.topLevel));
  await assert.rejects(lstat(selected.store));
  await assert.rejects(lstat(selected.alternateAlias));
  assert.equal((await lstat(join(root, "node_modules", "@github"))).isDirectory(), true);
  assert.equal((await lstat(wrongTarget)).isDirectory(), true);
  assert.equal((await lstat(unrelated)).isDirectory(), true);
  assert.equal(await readFile(join(assets, ".paperclip-copilot-closure.json"), "utf8"), "verified closure");
  assert.equal(await readFile(join(assets, "copilot"), "utf8"), "verified executable");
  assert.equal(await readFile(join(assets, "distribution", "messages.json"), "utf8"), "verified distribution");
});

test("removes an empty physical Copilot namespace after pruning the exact target", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-copilot-empty-scope-"));
  roots.push(root);
  const selected = await pnpmCopilotMaterializerFixture(root, "@github/copilot-darwin-arm64");
  const assets = join(root, "server", "provider-assets", "copilot", "darwin-arm64");
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, ".paperclip-copilot-closure.json"), "verified closure");
  await writeFile(join(assets, "copilot"), "verified executable");

  pruneVerifiedCopilotMaterializer({ runtimeRoot: root, platform: "darwin", arch: "arm64" });
  await assert.rejects(lstat(selected.topLevel));
  await assert.rejects(lstat(selected.store));
  await assert.rejects(lstat(selected.alternateAlias));
  await assert.rejects(lstat(join(root, "node_modules", "@github")));
  assert.equal(await readFile(join(assets, ".paperclip-copilot-closure.json"), "utf8"), "verified closure");
  assert.equal(await readFile(join(assets, "copilot"), "utf8"), "verified executable");
});

test("does not prune Copilot materializers on unsupported Windows", async () => {
  const root = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-copilot-win-"));
  roots.push(root);
  const materializer = await writeCopilotMaterializer(root, "@github/copilot-darwin-arm64");
  const result = pruneVerifiedCopilotMaterializer({ runtimeRoot: root, platform: "win32", arch: "x64" });
  assert.deepEqual(result, {
    supported: false,
    platform: "win32",
    arch: "x64",
    packageName: null,
    bytesSaved: 0,
  });
  assert.equal((await lstat(materializer)).isDirectory(), true);
});

test("refuses musl and unknown Linux libc before mutating staged payloads", async () => {
  for (const libc of ["musl", "unknown"]) {
    const setup = await fixture();
    const variant = await writePackage(setup.root, "opencode-linux-x64", "linux", "x64");
    const portable = await readFile(setup.portable);
    assert.throws(
      () => optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc }),
      new RegExp(`only Linux glibc; received ${libc}`),
    );
    assert.equal(await readFile(setup.portable, "utf8"), portable.toString());
    assert.equal((await lstat(variant)).isDirectory(), true);
  }
});

test("refuses missing selected packages and manifest identity drift", async () => {
  const missing = await fixture();
  await rm(missing.selected, { recursive: true, force: true });
  assert.throws(() => optimizeRuntimePayload({ runtimeRoot: missing.root, platform: "linux", arch: "x64", libc: "glibc" }), /missing/i);

  const mismatch = await fixture({ selectedVersion: "0.0.0" });
  assert.throws(() => inspectRuntimePayload({ runtimeRoot: mismatch.root, platform: "linux", arch: "x64", libc: "glibc" }), /identity mismatch/i);

  const upgraded = await fixture({ wrapperVersion: "1.18.35" });
  assert.throws(() => inspectRuntimePayload({ runtimeRoot: upgraded.root, platform: "linux", arch: "x64", libc: "glibc" }), /Review the desktop payload policy/i);

});

test("keeps the packaging target map aligned with the Runner resolver", () => {
  const runnerResolver = readFileSync(
    new URL("../../paperclip-runner/src/drivers/opencode/opencode-server-driver.ts", import.meta.url),
    "utf8",
  );
  assert.match(runnerResolver, new RegExp(`QUALIFIED_OPENCODE_VERSION = \"${runtimePayloadInternals.QUALIFIED_OPENCODE_VERSION}\"`));
  for (const [target, packageName] of Object.entries(runtimePayloadInternals.NATIVE_PACKAGE_BY_TARGET)) {
    assert.match(runnerResolver, new RegExp(`\"${target}\": \\[\"${packageName}\"\\]`));
  }
});

test("does not replace a portable executable with different bytes", async () => {
  const setup = await fixture({ portablePayload: "#!/bin/sh\necho other\n" });
  const before = await readFile(setup.portable, "utf8");
  const result = optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" });
  assert.equal(result.portableIsSymlink, false);
  assert.equal(await readFile(setup.portable, "utf8"), before);
  assert.equal(result.portableMatchesNative, false);
  assert.notEqual(digest(before), digest(await readFile(setup.source)));
});

test("prunes .pnpm-isolated OpenCode variants without touching selected links", async () => {
  const setup = await pnpmFixture();
  const variant = await writePackage(setup.root, "opencode-linux-x64", "linux", "x64");
  const variantStore = join(setup.nodeModules, ".pnpm", `opencode-linux-x64@${VERSION}`, "node_modules", "opencode-linux-x64");
  await mkdir(dirname(variantStore), { recursive: true });
  await rename(variant, variantStore);
  await symlink(variantStore, variant, "dir");

  const result = optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" });
  assert.deepEqual(result.unexpectedPackages, []);
  assert.equal((await lstat(setup.nativeStore)).isDirectory(), true);
  assert.equal((await lstat(setup.portable)).isSymbolicLink(), true);
  await assert.rejects(lstat(variantStore));
});

test("refuses selected paths that escape the staged runtime", async () => {
  const setup = await fixture();
  const sentinel = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-sentinel-"));
  roots.push(sentinel);
  const outside = join(sentinel, "opencode-linux-x64-baseline");
  await mkdir(join(outside, "bin"), { recursive: true });
  await writeFile(join(outside, "package.json"), JSON.stringify({ name: "opencode-linux-x64-baseline", version: VERSION, os: ["linux"], cpu: ["x64"] }));
  await writeFile(join(outside, "bin", "opencode"), "outside");
  await rm(setup.selected, { recursive: true, force: true });
  await symlink(outside, setup.selected, "dir");
  await assert.rejects(lstat(join(sentinel, "deleted-by-accident")));
  assert.throws(() => optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" }), /escapes/i);
  await writeFile(join(sentinel, "sentinel"), "kept");
  assert.equal(await readFile(join(sentinel, "sentinel"), "utf8"), "kept");
});

test("refuses a .pnpm parent that resolves outside the staged runtime", async () => {
  const setup = await fixture();
  const outside = await mkdtemp(join(tmpdir(), "paperclip-runtime-payload-pnpm-outside-"));
  roots.push(outside);
  const externalVariant = join(outside, "entry", "node_modules", "opencode-linux-x64");
  await mkdir(join(externalVariant, "bin"), { recursive: true });
  await writeFile(join(externalVariant, "package.json"), JSON.stringify({ name: "opencode-linux-x64", version: VERSION }));
  await writeFile(join(externalVariant, "bin", "opencode"), "outside");
  await symlink(outside, join(setup.nodeModules, ".pnpm"), "dir");

  assert.throws(
    () => optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" }),
    /escapes the staged runtime/i,
  );
  assert.equal(await readFile(join(externalVariant, "bin", "opencode"), "utf8"), "outside");
});

test("refuses a staged runtime root reached through a symbolic link", async () => {
  const setup = await fixture();
  const linkedRoot = `${setup.root}-link`;
  roots.push(linkedRoot);
  await symlink(setup.root, linkedRoot, "dir");
  assert.throws(
    () => optimizeRuntimePayload({ runtimeRoot: linkedRoot, platform: "linux", arch: "x64", libc: "glibc" }),
    /runtime root must not be a symbolic link/i,
  );
});

test("is repeatable and inspection reports remaining target variants", async () => {
  const setup = await fixture();
  await writePackage(setup.root, "opencode-linux-x64", "linux", "x64");
  assert.deepEqual(
    inspectRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" }).unexpectedPackages,
    ["opencode-linux-x64"],
  );
  const first = optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" });
  const second = optimizeRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" });
  assert.ok(first.bytesSaved > 0);
  assert.equal(second.bytesSaved, 0);
  assert.equal(inspectRuntimePayload({ runtimeRoot: setup.root, platform: "linux", arch: "x64", libc: "glibc" }).portableIsSymlink, true);
});
