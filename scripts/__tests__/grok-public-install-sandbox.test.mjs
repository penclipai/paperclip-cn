import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { isWorkspacePackage, parseWorkspaceEntries } from '../build-standalone-public-packages.mjs';
import { GROK_PUBLIC_INSTALL_IMAGE, GROK_PUBLIC_INSTALL_LIFECYCLE, assertInstalledCodexPlatformProvenance, assertNoBundledCodexPayloads, grokConsumerDockerArgs, installedCodexProbeSource } from '../grok-public-install-sandbox.mjs';

const paths = { assets: '/private/staging/assets', consumer: '/private/staging/consumer', cache: '/private/staging/cache', uid: 1001, gid: 1001 };
const values = (args, flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);

test('lifecycle execution has no network, host credentials, checkout, or elevated privileges', () => {
  const args = grokConsumerDockerArgs({ ...paths, command: GROK_PUBLIC_INSTALL_LIFECYCLE });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.deepEqual(values(args, '--user'), ['1001:1001']);
  assert.ok(args.includes('--read-only'));
  assert.deepEqual(values(args, '--cap-drop'), ['ALL']);
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges']);
  assert.deepEqual(values(args, '--mount'), [
    'type=bind,src=/private/staging/assets,dst=/packages,readonly',
    'type=bind,src=/private/staging/consumer,dst=/consumer',
    'type=bind,src=/private/staging/cache,dst=/cache',
  ]);
  assert.deepEqual(values(args, '--env'), ['HOME=/tmp', 'npm_config_cache=/cache', 'npm_config_nodedir=/usr/local', 'npm_config_audit=false', 'npm_config_fund=false', 'npm_config_ignore_scripts=false']);
  assert.match(GROK_PUBLIC_INSTALL_IMAGE, /@sha256:[a-f0-9]{64}$/);
});

test('deferred lifecycle execution rebuilds the installed graph without dependency resolution', () => {
  assert.deepEqual(GROK_PUBLIC_INSTALL_LIFECYCLE, ['npm', 'rebuild', '--offline', '--ignore-scripts=false', '--dangerously-allow-all-scripts']);
});

test('a root or malformed host identity cannot run lifecycle scripts', () => {
  for (const uid of [0, -1, undefined, '1001']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, uid, command: ['npm', 'ci'] }), /unprivileged/);
  }
});

test('only the scripts-disabled dependency download gets network access', () => {
  const args = grokConsumerDockerArgs({ ...paths, download: true, command: ['npm', 'install', '--ignore-scripts'] });
  assert.deepEqual(values(args, '--network'), ['bridge']);
  assert.ok(values(args, '--env').includes('npm_config_ignore_scripts=true'));
});

test('Pi assembly gets bounded scratch capacity while preserving sandbox restrictions', () => {
  const args = grokConsumerDockerArgs({ ...paths, download: true, temporarySizeMiB: 2048, command: ['node', '/consumer/node_modules/penclip/dist/index.js', 'runtime', 'setup', 'pi'] });
  assert.deepEqual(values(args, '--tmpfs'), ['/tmp:rw,nosuid,nodev,noexec,size=2048m,mode=1777']);
  assert.deepEqual(values(args, '--memory'), ['3g']);
  assert.ok(args.includes('--read-only'));
  assert.deepEqual(values(args, '--cap-drop'), ['ALL']);
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges']);
  for (const temporarySizeMiB of [0, 255, 2049, Infinity, '2048']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, temporarySizeMiB, command: ['node'] }), /bounded/);
  }
});

test('only an offline runtime probe can execute its verified scratch snapshot', () => {
  const command = ['node', '/packages/pi-public-install-probe.mjs', '/consumer/node_modules/@penclipai/server'];
  const args = grokConsumerDockerArgs({ ...paths, command, temporarySizeMiB: 2048, temporaryExecutable: true });
  assert.deepEqual(values(args, '--tmpfs'), ['/tmp:rw,nosuid,nodev,exec,size=2048m,mode=1777']);
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.deepEqual(values(args, '--user'), ['1001:1001']);
  assert.ok(args.includes('--read-only'));
  assert.deepEqual(values(args, '--cap-drop'), ['ALL']);
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges']);
  assert.throws(() => grokConsumerDockerArgs({ ...paths, command, download: true, temporaryExecutable: true }), /offline/);
  assert.throws(() => grokConsumerDockerArgs({ ...paths, command, temporaryExecutable: 'true' }), /offline/);
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(source.includes("temporarySizeMiB: 2048, temporaryExecutable: true"));
});

test('the separately provisioned executable is exposed read-only to the offline probe', () => {
  const prerequisite = '/private/staging/native/grok';
  const args = grokConsumerDockerArgs({ ...paths, prerequisite, command: ['node', '/packages/probe.mjs', 'present'] });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.equal(values(args, '--mount').at(-1), `type=bind,src=${prerequisite},dst=/opt/paperclip/providers/grok/1.0.13/grok,readonly`);
});

test('verification never elevates PR-controlled provisioning or cleanup on the host', () => {
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bsudo\b/);
  assert.ok(source.includes("const prerequisite = join(root, 'native/grok')"));
});

test('the image and Grok downloads start before staging and join without weakening the npm checks', () => {
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  const position = fragment => { const index = source.indexOf(fragment); assert.notEqual(index, -1, `verifier must contain ${fragment}`); return index; };
  // Exactly the pinned consumer image is pulled, for the platform the probes run on.
  const imagePull = position("prefetch('image', 'docker', ['pull', '--platform', 'linux/amd64', GROK_PUBLIC_INSTALL_IMAGE])");
  // Grok is provisioned into the prefetch directory, never straight into `native/grok`.
  const grokProvision = position("prefetch('grok', process.execPath, [join(repo, 'packages/paperclip-runner/scripts/provision-grok.mjs'), stagedGrok])");
  assert.ok(source.includes("const stagedGrok = join(prefetched, 'grok')"));
  assert.doesNotMatch(source, /provision-grok\.mjs'\), prerequisite\]/);
  // Both downloads start before any package is staged and before the first sandbox runs.
  const staging = position("visit('@penclipai/server')");
  const firstSandbox = position("isolated(['npm', 'install', '--ignore-scripts', '--omit=dev'");
  assert.ok(imagePull < staging && grokProvision < staging);
  assert.ok(position("await awaited('image', imageReady)") < firstSandbox);
  // The binary moves to the canonical host path only after npm is proven not to
  // have provisioned it, after the negative probe, and before the positive probe.
  const npmCheck = position("'npm must not provision Grok'");
  const negativeProbe = position("isolated(['node', '/packages/probe.mjs', 'missing'])");
  const grokJoin = position("await awaited('grok', grokReady)");
  const move = position('renameSync(stagedGrok, prerequisite)');
  const positiveProbe = position("isolated(['node', '/packages/probe.mjs', 'present'], { prerequisite })");
  assert.ok(npmCheck < negativeProbe && negativeProbe < grokJoin && grokJoin < move && move < positiveProbe);
  // The children run through the helper covered by prefetch-child.test.mjs, and
  // cleanup waits for them before removing the directory they write into.
  assert.ok(source.includes("import { startPrefetch, stopPrefetches } from './prefetch-child.mjs'"));
  assert.ok(position('await stopPrefetches(prefetches)') < position('rmSync(root, { recursive: true, force: true })'));
  assert.equal(source.match(/rmSync\(root/g).length, 1);
});

test('the bundled-dependency installs run together while the other packages are copied, and pack in order', () => {
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  const position = fragment => { const index = source.indexOf(fragment); assert.notEqual(index, -1, `verifier must contain ${fragment}`); return index; };
  // The installs are children of the script's own CLI entry through the helper
  // covered by stage-bundled-packages.test.mjs, never in-process calls.
  assert.doesNotMatch(source, /prepareBundledPackage/);
  assert.ok(source.includes("import { bundledInstallTimings, startBundledInstalls } from './stage-bundled-packages.mjs'"));
  // Only the bundled packages' sources are staged before the installs start;
  // the installs are registered for cleanup at once, before anything else can
  // fail; the other packages are copied while the installs run; the join comes
  // before the packs start; and the packs run through the helper covered by
  // pack-staged-packages.test.mjs, bundled packages first, each registered for
  // cleanup as it starts, with the results put back into dependency order
  // before every tarball is checked.
  const bundledSources = position('for (const entry of entries.filter(entry => entry.bundled)) stageSource(entry)');
  const start = position("startBundledInstalls(entries.filter(entry => entry.bundled), { logDir: prefetched, cwd: repo })");
  const registered = position('prefetches.push(...installs.map(({ handle }) => handle))');
  const otherSources = position('for (const entry of entries.filter(entry => !entry.bundled))');
  const join = position("await awaited('bundled', Promise.all(installs.map(({ handle }) => handle.done)))");
  assert.ok(source.includes("import { packConcurrency, packStagedPackages, packTimings } from './pack-staged-packages.mjs'"));
  const packs = position("await packStagedPackages([...entries].sort((a, b) => Number(b.bundled) - Number(a.bundled)), { logDir: prefetched, env, concurrency, register: handle => prefetches.push(handle) })");
  const reordered = position('packs.sort((a, b) => a.index - b.index)');
  const checks = position("for (const tarball of tarballs) assertNoBundledCodexPayloads(run('tar', ['-tzf', tarball])");
  const copied = position('for (const tarball of tarballs) {');
  assert.ok(bundledSources < start && start < registered && registered < otherSources && otherSources < join && join < packs && packs < reordered && reordered < checks && checks < copied);
  assert.equal(source.match(/run\('npm', \['pack'/g).length, 1, 'only the lifecycle sentinel is packed in-process');
  assert.ok(source.includes("destination: join(root, `pack-${index}`)"), 'each pack writes into its own directory');
  // The timing line reports the split staging phase, each install, and the
  // pack step with what the packs would have cost one after another.
  for (const key of ['stage_ui_dist_ms', 'stage_sources_ms', 'stage_bundled_ms', 'stage_pack_ms', 'stage_pack_check_ms']) assert.ok(source.includes(`timing.${key} =`));
  assert.ok(source.includes('...bundledInstallTimings(installs)'));
  assert.ok(source.includes('Object.assign(timing, packTimings(packs, concurrency))'));
});

test('the verifier stages only workspace packages, so it skips the standalone build release.sh needs', () => {
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const position = fragment => { const index = source.indexOf(fragment); assert.notEqual(index, -1, `verifier must contain ${fragment}`); return index; };
  // The standalone public packages are the ones outside the pnpm workspace
  // (the sandbox-provider plugins). release.sh builds them because it publishes
  // them; the verifier packs only the closure of the server and the CLI under
  // `workspace:` specs, and a `workspace:` spec can only name a workspace
  // package, so no tarball here ever contains or depends on a standalone build.
  // The one reader of that build is qualification-package retention, which
  // packs the Daytona plugin from its `dist`, so the build runs exactly when
  // retention is requested: the single reference sits inside that gate, and
  // the same flag is what later decides whether retention runs at all.
  const standaloneBuild = "run(process.execPath, [join(repo, 'scripts/build-standalone-public-packages.mjs')], repo)";
  assert.equal(source.split('build-standalone-public-packages').length - 1, 1, 'the standalone build is referenced once, inside the retention gate');
  const gate = position("const retainQualificationPackages = Boolean(process.env.PAPERCLIP_RUNNER_QUALIFICATION_PACKAGES_DIR);\n  if (retainQualificationPackages) {\n    const standaloneStarted = performance.now();\n    " + standaloneBuild);
  assert.ok(source.includes('timing.stage_standalone_build_ms ='), 'the gated build is timed under its own key');
  assert.ok(source.includes('if (retainQualificationPackages) {\n    const retained = retainRunnerQualificationPackages({'), 'retention is gated by the same flag as the build');
  assert.doesNotMatch(source, /if \(process\.env\.PAPERCLIP_RUNNER_QUALIFICATION_PACKAGES_DIR\)/, 'no second reading of the retention flag can diverge from the build gate');
  const retention = readFileSync(new URL('../retain-runner-qualification-packages.mjs', import.meta.url), 'utf8');
  assert.ok(retention.includes("const pluginRelative = 'packages/plugins/sandbox-providers/daytona';") && retention.includes("cpSync(join(repo, pluginRelative, 'dist'), join(plugin, 'dist'), { recursive: true })"), 'retention still packs the Daytona plugin from its dist, which is why the gated build exists');
  const repo = new URL('../../', import.meta.url);
  const listing = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/release-package-map.mjs', repo)), 'list'], { cwd: fileURLToPath(repo), encoding: 'utf8' });
  assert.equal(listing.status, 0, listing.stderr);
  const packages = new Map(listing.stdout.trim().split('\n').map(line => line.split('\t')).map(([dir, name]) => [name, { dir, manifest: JSON.parse(readFileSync(new URL(`${dir}/package.json`, repo), 'utf8')) }]));
  const needed = new Set();
  const visit = name => {
    if (needed.has(name)) return;
    const entry = packages.get(name); assert.ok(entry, `missing public workspace dependency ${name}`); needed.add(name);
    for (const [dep, spec] of Object.entries({ ...entry.manifest.dependencies, ...entry.manifest.optionalDependencies })) if (spec.startsWith('workspace:')) visit(dep);
  };
  assert.ok(source.includes("visit('@penclipai/server');\n  visit('penclip');"));
  visit('@penclipai/server'); visit('penclip');
  const workspace = parseWorkspaceEntries(readFileSync(new URL('pnpm-workspace.yaml', repo), 'utf8'));
  const standalone = [...packages.values()].filter(({ dir }) => !isWorkspacePackage(dir, workspace)).map(({ dir }) => dir);
  assert.ok(standalone.length > 0, 'the public package map must still carry standalone packages for this check to mean anything');
  assert.ok(standalone.includes('packages/plugins/sandbox-providers/daytona'), 'the Daytona plugin retention packs is a standalone package, so pnpm build alone cannot produce its dist');
  for (const name of needed) assert.ok(isWorkspacePackage(packages.get(name).dir, workspace), `${name} is staged by the verifier but is not a workspace package`);
  // The server publishes `ui-dist`, so that copy stays, before any package is
  // staged, reusing the UI that `pnpm build` produced, and it is timed. The
  // gated standalone build keeps release.sh's order: after the closure is
  // known and before the UI copy and any staged source.
  assert.deepEqual(JSON.parse(readFileSync(new URL('server/package.json', repo), 'utf8')).files, ['dist', 'ui-dist', 'skills']);
  assert.ok(source.includes("PAPERCLIP_RELEASE_REUSE_UI_DIST: '1'"));
  const uiDist = position("run(process.execPath, [join(repo, 'scripts/prepare-server-ui-dist.mjs')], repo)");
  assert.ok(position("visit('penclip')") < gate && gate < uiDist && uiDist < position('timing.stage_ui_dist_ms =') && uiDist < position('const stageSource = '));
});

test('the installed Codex probe exercises the public export and rejects incomplete or mismatched packages', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'installed-codex-probe-')));
  try {
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    const target = `${process.platform}-${process.arch}`;
    const platformPath = `node_modules/@openai/codex-${target}`;
    const platform = join(consumer, platformPath); mkdirSync(platform, { recursive: true });
    const nativeVendor = join(platform, 'vendor'); mkdirSync(nativeVendor);
    const manifest = { name: '@openai/codex', version: `0.160.0-${target}`, os: [process.platform], cpu: [process.arch] };
    writeFileSync(join(platform, 'package.json'), JSON.stringify(manifest));
    const entry = { name: manifest.name, version: manifest.version,
      resolved: `https://registry.npmjs.org/@openai/codex/-/codex-${manifest.version}.tgz`, integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` };
    const lock = { lockfileVersion: 3, packages: { [platformPath]: entry } };
    writeFileSync(join(consumer, 'package-lock.json'), JSON.stringify(lock));
    const server = join(consumer, 'node_modules/@penclipai/server');
    const vendor = join(server, 'dist/vendor/paperclip-runner'), drivers = join(vendor, 'drivers/acpx'); mkdirSync(drivers, { recursive: true });
    writeFileSync(join(server, 'package.json'), JSON.stringify({ name: '@penclipai/server', type: 'module' }));
    const integrity = join(drivers, 'installation-integrity.js');
    const security = join(vendor, 'drivers/codex/codex-security-config.js'); mkdirSync(join(vendor, 'drivers/codex'));
    const securitySource = `export const codexExecutableReadOnlyRoots = () => [${JSON.stringify(nativeVendor)}];
      export const createIsolatedCodexAppServerArgs = (source, roots) => roots.map(root => JSON.stringify(root) + '=\"read\"');`;
    writeFileSync(security, securitySource);
    const moduleSource = `import assert from 'node:assert/strict'; import { writeFileSync } from 'node:fs';
      export function createAcpxPackageJsonResolver(root, manifest) { assert.equal(root, ${JSON.stringify(server)}); assert.equal(manifest, ${JSON.stringify(join(server, 'package.json'))}); return () => 'selected-authority'; }
      export async function verifyQualifiedAcpxInstallation(profile, resolver) { assert.deepEqual(profile, { agent: 'codex', model: 'gpt-5.4' }); assert.equal(resolver(), 'selected-authority');
        return { openCommand: async () => ({ close: async () => { writeFileSync(${JSON.stringify(join(server, 'lease-closed'))}, 'ok'); } }) }; }`;
    writeFileSync(integrity, moduleSource);
    writeFileSync(join(drivers, 'qualified-profiles.js'), "export const resolveQualifiedAcpxProfile = (agent, model) => ({ agent, model });");
    const wrapper = join(consumer, 'node_modules/@openai/codex/bin'); mkdirSync(wrapper, { recursive: true });
    writeFileSync(join(wrapper, '../package.json'), JSON.stringify({ name: '@openai/codex', version: '0.160.0' }));
    const index = join(vendor, 'index.mjs'), command = join(wrapper, 'codex.js'), probe = join(root, 'probe.mjs');
    const executable = version => writeFileSync(command, `#!/usr/bin/env node\nif (process.argv[2] !== '--version') process.exit(65);\nconsole.log('codex-cli ${version}');\n`, { mode: 0o755 });
    writeFileSync(probe, installedCodexProbeSource(index, consumer, '0.160.0'));
    const run = () => spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/bin:/bin', NODE_PATH: '' } });
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(command)};`);
    executable('0.160.0');
    let result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).pinnedCodexCommandVerified, true);
    assert.equal(JSON.parse(result.stdout).codexPlatformPackageSource, 'official npm');
    assert.equal(JSON.parse(result.stdout).codexConsumerPlatform, target);
    assert.equal(JSON.parse(result.stdout).codexQualifiedInstallationVerified, true);
    assert.equal(JSON.parse(result.stdout).codexCommandLeaseVerified, true);
    assert.equal(JSON.parse(result.stdout).codexNativeSandboxResourcesVerified, true);
    assert.equal(readFileSync(join(server, 'lease-closed'), 'utf8'), 'ok');
    assert.equal(JSON.parse(result.stdout).providerCalls, 0);
    const legacyPath = 'node_modules/legacy-codex-adapter/node_modules/@openai/codex-' + target;
    const legacy = join(consumer, legacyPath); mkdirSync(legacy, { recursive: true });
    const legacyManifest = { ...manifest, version: '0.156.1-' + target };
    writeFileSync(join(legacy, 'package.json'), JSON.stringify(legacyManifest));
    lock.packages[legacyPath] = { ...entry, version: legacyManifest.version,
      resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-' + legacyManifest.version + '.tgz' };
    writeFileSync(join(consumer, 'package-lock.json'), JSON.stringify(lock));
    result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).codexPlatformPackages.length, 2);
    assert.equal(JSON.parse(result.stdout).codexSelectedPlatformPath, platformPath);
    assert.equal(JSON.parse(result.stdout).codexSelectedPlatformVersion, '0.160.0-' + target);
    const legacyCommand = join(legacy, 'codex');
    writeFileSync(legacyCommand, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(legacyCommand)};`);
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Selected Codex platform version must match the qualified pin/);
    writeFileSync(index, `import { writeFileSync } from 'node:fs'; export const resolvePinnedCodexCommand = () => {
      writeFileSync(${JSON.stringify(join(platform, 'package.json'))}, ${JSON.stringify(JSON.stringify({ ...manifest, altered: true }))});
      return ${JSON.stringify(command)}; };`);
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /metadata must match its scanned provenance/);
    writeFileSync(join(platform, 'package.json'), JSON.stringify(manifest));
    writeFileSync(index, "export const resolvePinnedCodexCommand = () => { throw new Error('Bundled Codex runtime version mismatch'); };");
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /Bundled Codex runtime version mismatch/);
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(command)};`);
    writeFileSync(security, securitySource.replace(JSON.stringify(nativeVendor), '"/missing-vendor-root"'));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /vendor directory must be readable/);
    writeFileSync(security, securitySource.replace(JSON.stringify(nativeVendor), `${JSON.stringify(nativeVendor)}, ${JSON.stringify(consumer)}`));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /must not grant enclosing npm/);
    writeFileSync(security, securitySource.replace("'=\"read\"'", "'=\"write\"'"));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /retain the selected native executable resources/);
    writeFileSync(security, securitySource);
    const emptySlot = join(server, 'node_modules/@openai/codex-' + target);
    mkdirSync(emptySlot, { recursive: true });
    result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).codexPlatformPackages.length, 2,
      'An empty nested npm optional slot must not obscure the qualified hoisted host package');
    writeFileSync(join(emptySlot, 'undeclared-native-payload'), 'native fixture; never executed');
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /empty regular directory; found.*undeclared-native-payload/);
    rmSync(join(emptySlot, 'undeclared-native-payload'));
    writeFileSync(join(emptySlot, 'package.json'), '{ malformed');
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /SyntaxError/);
    rmSync(join(emptySlot, 'package.json'));
    writeFileSync(integrity, moduleSource.replace('assert.deepEqual(profile,', "throw new Error('qualified executable digest mismatch'); assert.deepEqual(profile,"));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /qualified executable digest mismatch/);
    writeFileSync(integrity, moduleSource.replace("writeFileSync(", "throw new Error('command lease close failed'); writeFileSync("));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /command lease close failed/);
    writeFileSync(integrity, moduleSource);
    lock.packages[platformPath].inBundle = true;
    writeFileSync(join(consumer, 'package-lock.json'), JSON.stringify(lock));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /downloaded, not bundled/);
    delete lock.packages[platformPath].inBundle;
    writeFileSync(join(consumer, 'package-lock.json'), JSON.stringify(lock));
    const foreign = join(consumer, 'node_modules/@openai/codex-win32-arm64'); mkdirSync(foreign);
    writeFileSync(join(foreign, 'package.json'), JSON.stringify({ name: '@openai/codex', version: '0.160.0-win32-arm64' }));
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /only the host/);
    rmSync(foreign, { recursive: true });
    executable('9.9.9'); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /qualified pin/);
    rmSync(command); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /ENOENT/);
    const outside = join(root, 'outside'); writeFileSync(outside, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(outside)};`);
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /inside the installed consumer/);
    writeFileSync(index, 'export const unrelated = true;'); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /must export the pinned Codex resolver/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('actual tar member checks allow Codex JavaScript but reject nested platform packages and native vendor payloads', () => {
  const javascript = ['package/package.json', 'package/node_modules/@openai/codex/package.json',
    'package/node_modules/@openai/codex/bin/codex.js', 'package/dist/vendor/paperclip-runner/index.js'];
  assert.doesNotThrow(() => assertNoBundledCodexPayloads(javascript));
  for (const payload of [
    'package/node_modules/@openai/codex-linux-x64/package.json',
    'package/node_modules/bridge/node_modules/@openai/codex-darwin-arm64/package.json',
    'package/node_modules/@openai/codex-win32-x64/package.json',
    'package/node_modules/@openai/codex/vendor/x86_64-unknown-linux-musl/codex/codex',
    'package/dist/vendor/aarch64-apple-darwin/bin/codex',
    'package/dist/vendor/x86_64-pc-windows-msvc/bin/codex.exe',
  ]) assert.throws(() => assertNoBundledCodexPayloads([...javascript, payload]), /must not bundle/);
  assert.throws(() => assertNoBundledCodexPayloads(['package/../outside']), /inside the package/);
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  assert.match(source, /assertNoBundledCodexPayloads\(run\('tar', \['-tzf', tarball\]\)/);
});

test('consumer provenance rejects bundled, foreign, inconsistent and non-official Codex payloads', () => {
  const path = 'node_modules/@openai/codex-linux-x64';
  const manifest = { name: '@openai/codex', version: '0.160.0-linux-x64', os: ['linux'], cpu: ['x64'] };
  const entry = { version: manifest.version, resolved: `https://registry.npmjs.org/@openai/codex/-/codex-${manifest.version}.tgz`,
    integrity: `sha512-${Buffer.alloc(64, 1).toString('base64')}` };
  const check = (value = entry, installed = [{ path, manifest }]) => assertInstalledCodexPlatformProvenance({ packages: { [path]: value } }, installed, 'linux-x64');
  assert.equal(check().codexConsumerHostOnly, true);
  const legacyManifest = { ...manifest, version: '0.156.1-linux-x64' };
  assert.equal(check({ ...entry, version: legacyManifest.version,
    resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-0.156.1-linux-x64.tgz' }, [{ path, manifest: legacyManifest }]).codexConsumerHostOnly, true);
  assert.throws(() => check(entry, [{ path, manifest: { ...manifest, version: '^0.160.0-linux-x64' } }]), /exact host version/);
  for (const change of [
    { inBundle: true }, { link: true }, { version: '0.156.1-linux-x64' },
    { resolved: 'https://example.com/@openai/codex/-/codex-0.160.0-linux-x64.tgz' },
    { resolved: 'https://registry.npmjs.org/@openai/codex/-/codex-0.156.1-linux-x64.tgz' },
    { resolved: 'https://user@registry.npmjs.org/@openai/codex/-/codex-0.160.0-linux-x64.tgz' },
    { integrity: undefined }, { integrity: 'sha512-AA==' },
  ]) assert.throws(() => check({ ...entry, ...change }));
  assert.throws(() => check(entry, []), /must install its host/);
  assert.throws(() => check(entry, [{ path: 'node_modules/@openai/codex-darwin-arm64', manifest }]), /only the host/);
  assert.throws(() => check(entry, [{ path, manifest: { ...manifest, name: 'untrusted' } }]), /identity/);
});
