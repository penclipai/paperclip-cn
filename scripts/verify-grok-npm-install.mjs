#!/usr/bin/env node
// Run on a disposable Linux verification host after pnpm build. No publication,
// credentials, inference, or changes to release versions. Native provisioning is
// explicit and separate from npm installation, and is removed in finally.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packConcurrency, packStagedPackages, packTimings } from './pack-staged-packages.mjs';
import { materializePublishManifest } from './prepare-bundled-package.mjs';
import { GROK_PUBLIC_INSTALL_IMAGE, GROK_PUBLIC_INSTALL_LIFECYCLE, assertNoBundledCodexPayloads, grokConsumerDockerArgs, installedCodexProbeSource } from './grok-public-install-sandbox.mjs';
import { startPrefetch, stopPrefetches } from './prefetch-child.mjs';
import { retainRunnerQualificationPackages } from './retain-runner-qualification-packages.mjs';
import { bundledInstallTimings, startBundledInstalls } from './stage-bundled-packages.mjs';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
assert.equal(process.platform, 'linux', 'Run this verification on disposable EC2 Linux, not a developer host');
const root = mkdtempSync(join(tmpdir(), 'paperclip-grok-public-install-'));
const prerequisite = join(root, 'native/grok');
const env = { ...process.env, NODE_PATH: '', PAPERCLIP_RELEASE_REUSE_UI_DIST: '1', npm_config_ignore_scripts: 'false', npm_config_audit: 'false', npm_config_fund: 'false' };
const run = (cmd, args, cwd = root) => execFileSync(cmd, args, { cwd, env, stdio: 'pipe', maxBuffer: 32 * 1024 * 1024 });
const sourceRevision = run('git', ['rev-parse', 'HEAD'], repo).toString().trim();
const releaseVersion = `0.0.0-grok-verify.${sourceRevision.slice(0, 12)}`;
// The two network downloads the probes need do not depend on anything packed
// below, so they overlap the CPU-bound staging instead of running after it.
// The consumer image is pinned by digest and the Grok binary is checked against
// its pinned sha256 by the provisioning script, so an early start changes no
// verified property. Neither touches the consumer, the assets, nor the
// `native/grok` path that the post-install assertion inspects.
const prefetched = join(root, 'prefetch'); mkdirSync(prefetched);
const stagedGrok = join(prefetched, 'grok');
// Every background child, downloads and bundled-dependency installs alike, is
// stopped in `finally`; `downloads` is the subset the timing line reports as
// prefetches.
const prefetches = [];
const downloads = [];
const timing = {};
// A prefetch failure surfaces where its result is awaited, never as an
// unhandled rejection that would mask an earlier staging error.
const prefetch = (name, cmd, args) => {
  const handle = startPrefetch({ name, cmd, args, cwd: root, env, logPath: join(prefetched, `${name}.log`) });
  prefetches.push(handle);
  downloads.push(handle);
  return handle.done;
};
let phaseStarted = performance.now();
const phase = name => { const now = performance.now(); timing[`${name}_ms`] = Math.round(now - phaseStarted); phaseStarted = now; };
const awaited = async (name, promise) => { const started = performance.now(); await promise; timing[`${name}_wait_ms`] = Math.round(performance.now() - started); };
try {
  const imageReady = prefetch('image', 'docker', ['pull', '--platform', 'linux/amd64', GROK_PUBLIC_INSTALL_IMAGE]);
  // Provision as the unprivileged verification user, never into the host's /opt.
  // Only the positive probe sees this file at the canonical sandbox path.
  const grokReady = prefetch('grok', process.execPath, [join(repo, 'packages/paperclip-runner/scripts/provision-grok.mjs'), stagedGrok]);
  const listing = run(process.execPath, [join(repo, 'scripts/release-package-map.mjs'), 'list'], repo).toString().trim().split('\n').map(line => line.split('\t'));
  const packages = new Map(listing.map(([dir, name]) => [name, { dir, manifest: JSON.parse(readFileSync(join(repo, dir, 'package.json'), 'utf8')) }]));
  const needed = new Set();
  function visit(name) {
    if (needed.has(name)) return;
    const entry = packages.get(name); assert.ok(entry, `Missing public workspace dependency ${name}`); needed.add(name);
    for (const [dep, spec] of Object.entries({ ...entry.manifest.dependencies, ...entry.manifest.optionalDependencies })) {
      if (spec.startsWith('workspace:')) visit(dep);
    }
  }
  visit('@penclipai/server');
  visit('penclip');
  // release.sh also builds the standalone public packages (the sandbox-provider
  // plugins outside the pnpm workspace) before it stages anything, because it
  // publishes them. Nothing staged here reaches them: `needed` is closed under
  // `workspace:` specs, so every package staged below is a workspace package
  // that `pnpm build` already built, and that build would only cost one
  // network install and compile per plugin whose output no tarball reads.
  // Canary Dry Run still runs it through release.sh. The one path that does
  // read a standalone build is qualification-package retention at the end:
  // it packs the Daytona plugin from its `dist`, which only this build
  // produces, so the build runs when retention is requested and nowhere else.
  const retainQualificationPackages = Boolean(process.env.PAPERCLIP_RUNNER_QUALIFICATION_PACKAGES_DIR);
  if (retainQualificationPackages) {
    const standaloneStarted = performance.now();
    run(process.execPath, [join(repo, 'scripts/build-standalone-public-packages.mjs')], repo);
    timing.stage_standalone_build_ms = Math.round(performance.now() - standaloneStarted);
  }
  // The server's `ui-dist` payload is prepared here; with the reuse flag set
  // above, that copies the `ui/dist` that `pnpm build` produced instead of
  // building the UI again.
  const uiDistStarted = performance.now();
  run(process.execPath, [join(repo, 'scripts/prepare-server-ui-dist.mjs')], repo);
  timing.stage_ui_dist_ms = Math.round(performance.now() - uiDistStarted);
  // Match release.sh's unified versioning in temporary staging directories.
  // Source manifests remain untouched, including independently versioned SDKs.
  // Each package's published files are staged into `source-<index>` and its
  // pack input into `package-<index>`, with <index> in dependency order so the
  // tarball list keeps matching `needed`. The packages that bundle dependencies
  // each need a host-side `npm install` of their bundled closure; those installs
  // write only their own `package-<index>` and read nothing another package
  // produces, so they start first and run together while the other packages
  // are copied, instead of one after another inside one loop. Packing is a
  // Node start-up plus CPU-bound gzip per package that reads only the package's
  // own directory, so the packs also run together, each into its own
  // `pack-<index>`, and the tarballs are checked in order once all are made.
  const entries = [...needed].map((name, index) => {
    const { dir, manifest } = packages.get(name);
    const bundled = (manifest.bundleDependencies ?? manifest.bundledDependencies ?? []).length > 0;
    return { name, index, dir, manifest, bundled, target: join(root, `package-${index}`), stagedSource: join(root, `source-${index}`), destination: join(root, `pack-${index}`) };
  });
  const stageSource = ({ dir, manifest, stagedSource }) => {
    mkdirSync(stagedSource);
    for (const file of manifest.files ?? ['dist']) {
      // release.sh stages runtime skills into these public packages before pack.
      const releaseSkills = file === 'skills' && ['server', 'packages/adapters/claude-local', 'packages/adapters/codex-local'].includes(dir);
      // Other adapters declare an optional skills directory that npm pack omits
      // when absent. Do not fabricate extra release payloads for those adapters.
      if (file === 'skills' && !releaseSkills && !existsSync(join(repo, dir, file))) continue;
      cpSync(releaseSkills ? join(repo, 'skills') : join(repo, dir, file), join(stagedSource, file), { recursive: true });
    }
    const releaseManifest = { ...manifest, version: releaseVersion };
    writeFileSync(join(stagedSource, 'package.json'), JSON.stringify(releaseManifest));
    return releaseManifest;
  };
  const sourcesStarted = performance.now();
  for (const entry of entries.filter(entry => entry.bundled)) stageSource(entry);
  const installsStarted = performance.now();
  const installs = startBundledInstalls(entries.filter(entry => entry.bundled), { logDir: prefetched, cwd: repo });
  prefetches.push(...installs.map(({ handle }) => handle));
  for (const entry of entries.filter(entry => !entry.bundled)) {
    const releaseManifest = stageSource(entry);
    mkdirSync(entry.target);
    cpSync(entry.stagedSource, entry.target, { recursive: true });
    writeFileSync(join(entry.target, 'package.json'), JSON.stringify(materializePublishManifest(releaseManifest)));
  }
  timing.stage_sources_ms = Math.round(performance.now() - sourcesStarted);
  await awaited('bundled', Promise.all(installs.map(({ handle }) => handle.done)));
  timing.stage_bundled_ms = Math.round(performance.now() - installsStarted);
  const packStarted = performance.now();
  // The bundled packages make the largest tarballs, so they are launched first
  // and the short packs fill the remaining slots behind them. Each pack is
  // registered for cleanup as it starts, so a failure stops the ones still
  // running before the scratch root is removed. The results are put back into
  // dependency order before the tarballs are checked and copied.
  const concurrency = packConcurrency();
  const packs = await packStagedPackages([...entries].sort((a, b) => Number(b.bundled) - Number(a.bundled)), { logDir: prefetched, env, concurrency, register: handle => prefetches.push(handle) });
  packs.sort((a, b) => a.index - b.index);
  const checksStarted = performance.now();
  const tarballs = packs.map(({ tarball }) => tarball);
  for (const tarball of tarballs) assertNoBundledCodexPayloads(run('tar', ['-tzf', tarball]).toString().trim().split('\n'));
  timing.stage_pack_check_ms = Math.round(performance.now() - checksStarted);
  timing.stage_pack_ms = Math.round(performance.now() - packStarted);
  Object.assign(timing, packTimings(packs, concurrency));
  const assets = join(root, 'assets'); mkdirSync(assets, { mode: 0o755 });
  const consumer = join(root, 'consumer'); mkdirSync(consumer);
  const cache = join(root, 'cache'); mkdirSync(cache);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  for (const tarball of tarballs) {
    const destination = join(assets, basename(tarball)); cpSync(tarball, destination); chmodSync(destination, 0o644);
  }
  // Prove lifecycle execution is real even if npm changes its script defaults.
  const sentinelSource = join(root, 'lifecycle-sentinel'); mkdirSync(sentinelSource);
  writeFileSync(join(sentinelSource, 'package.json'), JSON.stringify({
    name: 'paperclip-verification-lifecycle-sentinel', version: '1.0.0', private: true,
    scripts: { postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'lifecycle-ran\', \'ok\')"' },
  }));
  run('npm', ['pack', '--ignore-scripts', '--pack-destination', assets], sentinelSource);
  const sentinel = join(consumer, 'node_modules/paperclip-verification-lifecycle-sentinel/lifecycle-ran');
  const consumerUid = process.getuid();
  const isolated = (command, options = {}) => run('docker', grokConsumerDockerArgs({ assets, consumer, cache, uid: consumerUid, gid: process.getgid(), command, ...options }));
  phase('stage_packages');
  await awaited('image', imageReady);
  // npm resolution is intentionally the public consumer graph, not the pnpm
  // workspace graph. Freeze that result before any lifecycle script can run.
  isolated(['npm', 'install', '--ignore-scripts', '--omit=dev', ...readdirSync(assets).filter(file => file.endsWith('.tgz')).map(file => `/packages/${file}`)], { download: true });
  phase('consumer_install');
  assert.equal(existsSync(sentinel), false, 'Dependency download must not run lifecycle scripts');
  const consumerLock = readFileSync(join(consumer, 'package-lock.json'), 'utf8');
  // npm ci rejects bundled optional platform dependencies absent from its own
  // generated lock. Rebuild runs the deferred install hooks on the installed
  // graph without re-resolving it; network isolation and lock checks still hold.
  isolated(GROK_PUBLIC_INSTALL_LIFECYCLE);
  assert.equal(readFileSync(sentinel, 'utf8'), 'ok', 'Offline lifecycle scripts must actually execute');
  assert.equal(readFileSync(join(consumer, 'package-lock.json'), 'utf8'), consumerLock, 'Lifecycle execution must preserve the resolved consumer lock');
  phase('lifecycle_rebuild');
  for (const name of needed) {
    const installedManifest = JSON.parse(readFileSync(join(consumer, 'node_modules', name, 'package.json'), 'utf8'));
    assert.equal(installedManifest.version, releaseVersion, `Installed release version for ${name}`);
  }
  assert.equal(existsSync(prerequisite), false, 'npm must not provision Grok');
  const server = join(consumer, 'node_modules/@penclipai/server');
  const installed = join(server, 'dist/vendor/paperclip-runner');
  const codexVersion = JSON.parse(readFileSync(join(repo, 'packages/paperclip-runner/acpx-profiles.json'), 'utf8')).profiles.codex.agentRuntimeVersion;
  assert.match(codexVersion, /^\d+\.\d+\.\d+$/);
  writeFileSync(join(assets, 'codex-probe.mjs'), installedCodexProbeSource(
    '/consumer/node_modules/@penclipai/server/dist/vendor/paperclip-runner/index.js', '/consumer', codexVersion), { mode: 0o644 });
  const codex = JSON.parse(isolated(['node', '/packages/codex-probe.mjs']).toString().trim());
  phase('codex_probe');
  assert.equal(codex.codexConsumerHostOnly, true);
  assert.equal(codex.codexPlatformPackageSource, 'official npm');
  assert.ok(existsSync(join(installed, 'providers/grok/launcher.cjs')));
  assert.equal(existsSync(join(consumer, 'node_modules/@penclipai/grok-acp')), false);
  assert.equal(existsSync(join(installed, 'providers/grok/bin')), false);
  // Use real installed compiled code and its actual npm dependency graph. A
  // separate process prevents module resolution from borrowing this checkout.
  const probe = `
    import assert from 'node:assert/strict';
    import { verifyQualifiedAcpxInstallation } from '/consumer/node_modules/@penclipai/server/dist/vendor/paperclip-runner/drivers/acpx/installation-integrity.js';
    import { resolveQualifiedAcpxProfile } from '/consumer/node_modules/@penclipai/server/dist/vendor/paperclip-runner/drivers/acpx/qualified-profiles.js';
    const profile = resolveQualifiedAcpxProfile('grok', 'grok-4.7');
    const inspect = () => verifyQualifiedAcpxInstallation(profile, () => { throw new Error('Grok must not resolve an npm package'); });
    if (process.argv[2] === 'missing') await assert.rejects(inspect, /prerequisite missing/);
    else { const installation = await inspect(); assert.equal(installation.agentServerPackageJsonPath, null); assert.equal(installation.agentRuntimePackageJsonPath, null); await (await installation.openCommand()).close(); }
  `;
  writeFileSync(join(assets, 'probe.mjs'), probe, { mode: 0o644 });
  isolated(['node', '/packages/probe.mjs', 'missing']);
  // The binary was provisioned outside `native/grok` while the packages were
  // staged, so the assertion above still proves npm put nothing there. It moves
  // into place only now, so only the positive probe sees it.
  await awaited('grok', grokReady);
  mkdirSync(dirname(prerequisite), { recursive: true });
  renameSync(stagedGrok, prerequisite);
  isolated(['node', '/packages/probe.mjs', 'present'], { prerequisite });
  phase('grok_probes');
  console.log(JSON.stringify({ schema: 'paperclip.grok.public-npm-install.v1', sourceRevision, releaseVersion, lifecycleScriptsEnabled: true, lifecycleSentinelVerified: true, lifecycleNetwork: 'none', consumerImage: GROK_PUBLIC_INSTALL_IMAGE, consumerUid, consumerLockPreserved: true, cleanNpmInstall: true, packageCount: needed.size, codexPackedPayloadsOmitted: true, codexPackedPackagesChecked: tarballs.length, ...codex, builtinLauncherPresent: true, separateGrokPackage: false, npmProvisionedBinary: false, missingPrerequisiteRejected: true, provisionedBinaryVerified: true, commandLeaseVerified: true, providerCalls: 0 }));
  // Exercise Pi's public CLI and installed server, never a private workspace
  // package or binary override. Public dependency downloads are explicit and
  // isolated; the actual admission probe runs without a network or credentials.
  const piProbe = join(assets, 'pi-public-install-probe.mjs');
  cpSync(join(repo, 'scripts/pi-public-install-probe.mjs'), piProbe); chmodSync(piProbe, 0o644);
  // Pi assembles a bundled runtime in scratch space before atomic publication.
  // Keep the existing sandbox and memory bound; only this download needs more
  // temporary capacity than the smaller offline lifecycle probes.
  const setup = isolated(['node', '/consumer/node_modules/penclip/dist/index.js', 'runtime', 'setup', 'pi'], { download: true, temporarySizeMiB: 2048 }).toString();
  const receipt = JSON.parse(setup.trim());
  phase('pi_setup');
  assert.equal(receipt.status, 'installed_verified');
  assert.equal(receipt.target, 'linux-x64');
  assert.equal(readFileSync(join(consumer, 'package-lock.json'), 'utf8'), consumerLock, 'Pi setup must preserve the consumer dependency graph');
  // Verified launch leases also materialize the runtime in private scratch.
  // Docker defaults tmpfs to noexec. The offline admission probe must execute
  // its verified private snapshot while keeping lifecycle/download scratch noexec.
  console.log(isolated(['node', '/packages/pi-public-install-probe.mjs', '/consumer/node_modules/@penclipai/server'], { temporarySizeMiB: 2048, temporaryExecutable: true }).toString().trim());
  phase('pi_probe');
  // Wall time per phase, so the slow part of this step is visible in the CI log
  // without re-running it. `*_prefetch_ms` runs from a download's start to its
  // last output, and `*_wait_ms` is how long the main flow waited for a
  // prefetch that had not finished yet; zero means the overlap hid it entirely.
  // `stage_ui_dist_ms`, `stage_sources_ms`, `stage_bundled_ms` and
  // `stage_pack_ms` split the staging phase, and `stage_bundled_<package>_ms`
  // is each concurrent install. `stage_standalone_build_ms` appears only when
  // qualification-package retention made the standalone build necessary.
  const downloaded = Object.fromEntries(downloads.map(({ name, durationMs }) => [`${name}_prefetch_ms`, durationMs]));
  console.log(JSON.stringify({ schema: 'paperclip.public-npm-install.timing.v1', ...timing, ...downloaded, ...bundledInstallTimings(installs) }));
  if (retainQualificationPackages) {
    const retained = retainRunnerQualificationPackages({ repo, output: process.env.PAPERCLIP_RUNNER_QUALIFICATION_PACKAGES_DIR, sourceRevision, releaseVersion, env,
      publicArchives: [...needed].map((name, index) => ({ name, file: tarballs[index] })),
    });
    console.log(JSON.stringify(retained));
  }
} finally {
  // An earlier failure must not leave a prefetch running, and scratch is
  // removed only once both children have stopped writing into it.
  await stopPrefetches(prefetches);
  rmSync(root, { recursive: true, force: true });
}
