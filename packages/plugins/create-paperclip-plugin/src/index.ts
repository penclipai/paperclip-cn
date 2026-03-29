#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_TEMPLATES = ["default", "connector", "workspace"] as const;
type PluginTemplate = (typeof VALID_TEMPLATES)[number];
const VALID_CATEGORIES = new Set(["connector", "workspace", "automation", "ui"] as const);

export interface ScaffoldPluginOptions {
  pluginName: string;
  outputDir: string;
  template?: PluginTemplate;
  displayName?: string;
  description?: string;
  author?: string;
  category?: "connector" | "workspace" | "automation" | "ui";
  sdkPath?: string;
  publishedPackages?: boolean;
}

/** Validate npm-style plugin package names (scoped or unscoped). */
export function isValidPluginName(name: string): boolean {
  const scopedPattern = /^@[a-z0-9_-]+\/[a-z0-9._-]+$/;
  const unscopedPattern = /^[a-z0-9._-]+$/;
  return scopedPattern.test(name) || unscopedPattern.test(name);
}

/** Convert `@scope/name` to an output directory basename (`name`). */
function packageToDirName(pluginName: string): string {
  return pluginName.replace(/^@[^/]+\//, "");
}

/** Convert an npm package name into a manifest-safe plugin id. */
function packageToManifestId(pluginName: string): string {
  if (!pluginName.startsWith("@")) {
    return pluginName;
  }

  return pluginName.slice(1).replace("/", ".");
}

/** Build a human-readable display name from package name tokens. */
function makeDisplayName(pluginName: string): string {
  const raw = packageToDirName(pluginName).replace(/[._-]+/g, " ").trim();
  return raw
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function writeFile(target: string, content: string) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function formatFileDependency(absPath: string): string {
  return `file:${toPosixPath(path.resolve(absPath))}`;
}

function formatRelativeFileDependency(baseDir: string, targetPath: string): string {
  return `file:${toPosixPath(path.relative(baseDir, targetPath))}`;
}

function copyDir(sourceDir: string, targetDir: string) {
  fs.mkdirSync(targetDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function runPnpm(args: string[], cwd: string) {
  execFileSync("pnpm", args, {
    cwd,
    stdio: "pipe",
    shell: process.platform === "win32",
  });
}

function getLocalSdkPackagePath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "sdk");
}

function getRepoRootFromSdkPath(sdkPath: string): string {
  return path.resolve(sdkPath, "..", "..", "..");
}

function getLocalSharedPackagePath(sdkPath: string): string {
  return path.resolve(getRepoRootFromSdkPath(sdkPath), "packages", "shared");
}

function isInsideDir(targetPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packLocalPackage(packagePath: string, outputDir: string): string {
  const packageJsonPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Package package.json not found at ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
  };
  const packageName = packageJson.name ?? path.basename(packagePath);
  const packageVersion = packageJson.version ?? "0.0.0";
  const tarballFileName = `${packageName.replace(/^@/, "").replace("/", "-")}-${packageVersion}.tgz`;
  const sdkBundleDir = path.join(outputDir, ".paperclip-sdk");

  fs.mkdirSync(sdkBundleDir, { recursive: true });
  runPnpm(["build"], packagePath);
  runPnpm(["pack", "--pack-destination", sdkBundleDir], packagePath);

  const tarballPath = path.join(sdkBundleDir, tarballFileName);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Packed tarball was not created at ${tarballPath}`);
  }

  return tarballPath;
}

type DependencyRewrite = {
  name?: string;
  version?: string;
};

function rewriteWorkspaceDependencyVersions(
  deps: Record<string, string> | undefined,
  rewrites: Record<string, DependencyRewrite>,
): Record<string, string> | undefined {
  if (!deps) return deps;
  const next: Record<string, string> = {};
  for (const [name, value] of Object.entries(deps)) {
    const rewrite = rewrites[name];
    const nextName = rewrite?.name ?? name;
    const nextValue = rewrite?.version ?? (value.startsWith("workspace:") ? value.slice("workspace:".length) || "*" : value);
    next[nextName] = nextValue;
  }
  return next;
}

function rewritePackageFileContents(rootDir: string, replacements: Array<[string, string]>) {
  const textExtensions = new Set([".js", ".mjs", ".cjs", ".d.ts", ".map"]);
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!textExtensions.has(path.extname(entry.name))) continue;
      let content = fs.readFileSync(fullPath, "utf8");
      let changed = false;
      for (const [from, to] of replacements) {
        if (!content.includes(from)) continue;
        content = content.split(from).join(to);
        changed = true;
      }
      if (changed) {
        fs.writeFileSync(fullPath, content);
      }
    }
  }
}

function packCompatibilityPackage(
  packagePath: string,
  outputDir: string,
  options: {
    aliasName: string;
    dependencyRewrites?: Record<string, DependencyRewrite>;
    contentReplacements?: Array<[string, string]>;
  },
): string {
  const packageJsonPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Package package.json not found at ${packageJsonPath}`);
  }

  runPnpm(["build"], packagePath);

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as Record<string, unknown>;
  const publishConfig =
    typeof packageJson.publishConfig === "object" && packageJson.publishConfig !== null
      ? packageJson.publishConfig as Record<string, unknown>
      : {};
  const packageVersion = typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  const bundleDir = path.join(outputDir, ".paperclip-sdk");
  const compatDir = path.join(bundleDir, options.aliasName.replace(/^@/, "").replace("/", "__"));

  fs.rmSync(compatDir, { recursive: true, force: true });
  fs.mkdirSync(compatDir, { recursive: true });

  const distSource = path.join(packagePath, "dist");
  if (fs.existsSync(distSource)) {
    copyDir(distSource, path.join(compatDir, "dist"));
  }

  const readmeSource = path.join(packagePath, "README.md");
  if (fs.existsSync(readmeSource)) {
    fs.copyFileSync(readmeSource, path.join(compatDir, "README.md"));
  }

  if (options.contentReplacements?.length) {
    rewritePackageFileContents(path.join(compatDir, "dist"), options.contentReplacements);
  }

  const compatPackageJson = {
    name: options.aliasName,
    version: packageVersion,
    description: packageJson.description,
    type: packageJson.type ?? "module",
    keywords: packageJson.keywords,
    license: packageJson.license,
    repository: packageJson.repository,
    homepage: packageJson.homepage,
    bugs: packageJson.bugs,
    bin: publishConfig.bin ?? packageJson.bin,
    exports: publishConfig.exports ?? packageJson.exports,
    main: publishConfig.main ?? packageJson.main,
    types: publishConfig.types ?? packageJson.types,
    files: ["dist", "README.md"],
    dependencies: rewriteWorkspaceDependencyVersions(
      packageJson.dependencies as Record<string, string> | undefined,
      options.dependencyRewrites ?? {},
    ),
    optionalDependencies: rewriteWorkspaceDependencyVersions(
      packageJson.optionalDependencies as Record<string, string> | undefined,
      options.dependencyRewrites ?? {},
    ),
    peerDependencies: packageJson.peerDependencies,
    peerDependenciesMeta: packageJson.peerDependenciesMeta,
  };

  writeFile(path.join(compatDir, "package.json"), `${JSON.stringify(compatPackageJson, null, 2)}\n`);
  runPnpm(["pack", "--pack-destination", bundleDir], compatDir);

  const tarballFileName = `${options.aliasName.replace(/^@/, "").replace("/", "-")}-${packageVersion}.tgz`;
  const tarballPath = path.join(bundleDir, tarballFileName);
  if (!fs.existsSync(tarballPath)) {
    throw new Error(`Packed compatibility tarball was not created at ${tarballPath}`);
  }

  return tarballPath;
}

/**
 * Generate a complete Paperclip plugin starter project.
 *
 * Output includes manifest/worker/UI entries, SDK harness tests, bundler presets,
 * and a local dev server script for hot-reload workflow.
 */
export function scaffoldPluginProject(options: ScaffoldPluginOptions): string {
  const template = options.template ?? "default";
  if (!VALID_TEMPLATES.includes(template)) {
    throw new Error(`Invalid template '${template}'. Expected one of: ${VALID_TEMPLATES.join(", ")}`);
  }

  if (!isValidPluginName(options.pluginName)) {
    throw new Error("Invalid plugin name. Must be lowercase and may include scope, dots, underscores, or hyphens.");
  }

  if (options.category && !VALID_CATEGORIES.has(options.category)) {
    throw new Error(`Invalid category '${options.category}'. Expected one of: ${[...VALID_CATEGORIES].join(", ")}`);
  }

  const outputDir = path.resolve(options.outputDir);
  if (fs.existsSync(outputDir)) {
    throw new Error(`Directory already exists: ${outputDir}`);
  }

  const displayName = options.displayName ?? makeDisplayName(options.pluginName);
  const description = options.description ?? "A Paperclip plugin";
  const author = options.author ?? "Plugin Author";
  const category = options.category ?? (template === "workspace" ? "workspace" : "connector");
  const manifestId = packageToManifestId(options.pluginName);
  const localSdkPath = path.resolve(options.sdkPath ?? getLocalSdkPackagePath());
  const localSharedPath = getLocalSharedPackagePath(localSdkPath);
  const repoRoot = getRepoRootFromSdkPath(localSdkPath);
  const useWorkspaceSdk = isInsideDir(outputDir, repoRoot);
  const usePublishedPackages = options.publishedPackages === true && !useWorkspaceSdk;
  const sdkVersion = JSON.parse(fs.readFileSync(path.join(localSdkPath, "package.json"), "utf8")).version ?? "latest";
  const sharedVersion = JSON.parse(fs.readFileSync(path.join(localSharedPath, "package.json"), "utf8")).version ?? "latest";

  fs.mkdirSync(outputDir, { recursive: true });

  const packedCompatSdkTarball =
    useWorkspaceSdk || usePublishedPackages
      ? null
      : packCompatibilityPackage(localSdkPath, outputDir, {
          aliasName: "@paperclipai/plugin-sdk",
          dependencyRewrites: {
            "@penclipai/shared": {
              name: "@paperclipai/shared",
              version: sharedVersion,
            },
          },
          contentReplacements: [
            ["@penclipai/shared", "@paperclipai/shared"],
          ],
        });
  const packedCompatSharedTarball =
    useWorkspaceSdk || usePublishedPackages
      ? null
      : packCompatibilityPackage(localSharedPath, outputDir, {
          aliasName: "@paperclipai/shared",
        });

  const sdkDependency = useWorkspaceSdk
    ? "workspace:@penclipai/plugin-sdk@*"
    : usePublishedPackages
      ? `npm:@penclipai/plugin-sdk@${sdkVersion}`
      : formatRelativeFileDependency(outputDir, packedCompatSdkTarball!);
  const sharedDependency = useWorkspaceSdk
    ? "workspace:@penclipai/shared@*"
    : usePublishedPackages
      ? `npm:@penclipai/shared@${sharedVersion}`
      : formatRelativeFileDependency(outputDir, packedCompatSharedTarball!);

  const packageJson = {
    name: options.pluginName,
    version: "0.1.0",
    type: "module",
    private: true,
    description,
    scripts: {
      build: "node ./esbuild.config.mjs",
      "build:rollup": "rollup -c",
      dev: "node ./esbuild.config.mjs --watch",
      "dev:ui": "paperclip-plugin-dev-server --root . --ui-dir dist/ui --port 4177",
      test: "vitest run --config ./vitest.config.ts",
      typecheck: "tsc --noEmit"
    },
    paperclipPlugin: {
      manifest: "./dist/manifest.js",
      worker: "./dist/worker.js",
      ui: "./dist/ui/"
    },
    keywords: ["paperclip", "plugin", category],
    author,
    license: "MIT",
    ...(packedCompatSharedTarball
      ? {
          pnpm: {
            overrides: {
              "@paperclipai/shared": formatRelativeFileDependency(outputDir, packedCompatSharedTarball),
            },
          },
        }
      : {}),
    devDependencies: {
      "@paperclipai/plugin-sdk": sdkDependency,
      "@paperclipai/shared": sharedDependency,
      "@rollup/plugin-node-resolve": "^16.0.1",
      "@rollup/plugin-typescript": "^12.1.2",
      "@types/node": "^24.6.0",
      "@types/react": "^19.0.8",
      esbuild: "^0.27.3",
      rollup: "^4.38.0",
      tslib: "^2.8.1",
      typescript: "^5.7.3",
      vitest: "^3.0.5"
    },
    peerDependencies: {
      react: ">=18"
    }
  };

  writeFile(path.join(outputDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);

  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      lib: ["ES2022", "DOM"],
      jsx: "react-jsx",
      strict: true,
      skipLibCheck: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      outDir: "dist",
      rootDir: "."
    },
    include: ["src", "tests"],
    exclude: ["dist", "node_modules"]
  };

  writeFile(path.join(outputDir, "tsconfig.json"), `${JSON.stringify(tsconfig, null, 2)}\n`);

  writeFile(
    path.join(outputDir, "esbuild.config.mjs"),
    `import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });
const watch = process.argv.includes("--watch");

const workerCtx = await esbuild.context(presets.esbuild.worker);
const manifestCtx = await esbuild.context(presets.esbuild.manifest);
const uiCtx = await esbuild.context(presets.esbuild.ui);

if (watch) {
  await Promise.all([workerCtx.watch(), manifestCtx.watch(), uiCtx.watch()]);
  console.log("esbuild watch mode enabled for worker, manifest, and ui");
} else {
  await Promise.all([workerCtx.rebuild(), manifestCtx.rebuild(), uiCtx.rebuild()]);
  await Promise.all([workerCtx.dispose(), manifestCtx.dispose(), uiCtx.dispose()]);
}
`,
  );

  writeFile(
    path.join(outputDir, "rollup.config.mjs"),
    `import { nodeResolve } from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({ uiEntry: "src/ui/index.tsx" });

function withPlugins(config) {
  if (!config) return null;
  return {
    ...config,
    plugins: [
      nodeResolve({
        extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs"],
      }),
      typescript({
        tsconfig: "./tsconfig.json",
        declaration: false,
        declarationMap: false,
      }),
    ],
  };
}

export default [
  withPlugins(presets.rollup.manifest),
  withPlugins(presets.rollup.worker),
  withPlugins(presets.rollup.ui),
].filter(Boolean);
`,
  );

  writeFile(
    path.join(outputDir, "vitest.config.ts"),
    `import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.spec.ts"],
    environment: "node",
  },
});
`,
  );

  writeFile(
    path.join(outputDir, "src", "manifest.ts"),
    `import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: ${quote(manifestId)},
  apiVersion: 1,
  version: "0.1.0",
  displayName: ${quote(displayName)},
  description: ${quote(description)},
  author: ${quote(author)},
  categories: [${quote(category)}],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "dashboardWidget",
        id: "health-widget",
        displayName: ${quote(`${displayName} Health`)},
        exportName: "DashboardWidget"
      }
    ]
  }
};

export default manifest;
`,
  );

  writeFile(
    path.join(outputDir, "src", "worker.ts"),
    `import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("issue.created", async (event) => {
      const issueId = event.entityId ?? "unknown";
      await ctx.state.set({ scopeKind: "issue", scopeId: issueId, stateKey: "seen" }, true);
      ctx.logger.info("Observed issue.created", { issueId });
    });

    ctx.data.register("health", async () => {
      return { status: "ok", checkedAt: new Date().toISOString() };
    });

    ctx.actions.register("ping", async () => {
      ctx.logger.info("Ping action invoked");
      return { pong: true, at: new Date().toISOString() };
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
`,
  );

  writeFile(
    path.join(outputDir, "src", "ui", "index.tsx"),
    `import { usePluginAction, usePluginData, type PluginWidgetProps } from "@paperclipai/plugin-sdk/ui";

type HealthData = {
  status: "ok" | "degraded" | "error";
  checkedAt: string;
};

export function DashboardWidget(_props: PluginWidgetProps) {
  const { data, loading, error } = usePluginData<HealthData>("health");
  const ping = usePluginAction("ping");

  if (loading) return <div>Loading plugin health...</div>;
  if (error) return <div>Plugin error: {error.message}</div>;

  return (
    <div style={{ display: "grid", gap: "0.5rem" }}>
      <strong>${displayName}</strong>
      <div>Health: {data?.status ?? "unknown"}</div>
      <div>Checked: {data?.checkedAt ?? "never"}</div>
      <button onClick={() => void ping()}>Ping Worker</button>
    </div>
  );
}
`,
  );

  writeFile(
    path.join(outputDir, "tests", "plugin.spec.ts"),
    `import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

describe("plugin scaffold", () => {
  it("registers data + actions and handles events", async () => {
    const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities, "events.emit"] });
    await plugin.definition.setup(harness.ctx);

    await harness.emit("issue.created", { issueId: "iss_1" }, { entityId: "iss_1", entityType: "issue" });
    expect(harness.getState({ scopeKind: "issue", scopeId: "iss_1", stateKey: "seen" })).toBe(true);

    const data = await harness.getData<{ status: string }>("health");
    expect(data.status).toBe("ok");

    const action = await harness.performAction<{ pong: boolean }>("ping");
    expect(action.pong).toBe(true);
  });
});
`,
  );

  writeFile(
    path.join(outputDir, "README.md"),
    `# ${displayName}

${description}

## Development

\`\`\`bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
\`\`\`

${useWorkspaceSdk
  ? `This scaffold keeps compatibility imports from \`@paperclipai/plugin-sdk*\` while resolving them to the workspace packages published as \`@penclipai/*\`.\n\n`
  : usePublishedPackages
    ? `This scaffold keeps compatibility imports from \`@paperclipai/plugin-sdk*\` while installing the published packages from \`@penclipai/*\` via npm alias dependencies pinned from your local Paperclip checkout at:\n\n\`${toPosixPath(localSdkPath)}\`\n\n`
    : `This scaffold snapshots compatibility packages for \`@paperclipai/plugin-sdk\` and \`@paperclipai/shared\` from your local Paperclip checkout at:\n\n\`${toPosixPath(localSdkPath)}\`\n\nThe packed tarballs live in \`.paperclip-sdk/\` so the generated plugin can install immediately without waiting for npm publish.\n\n`}

## Install Into Paperclip

\`\`\`bash
curl -X POST http://127.0.0.1:3100/api/plugins/install \\
  -H "Content-Type: application/json" \\
  -d '{"packageName":"${toPosixPath(outputDir)}","isLocalPath":true}'
\`\`\`

## Build Options

- \`pnpm build\` uses esbuild presets from \`@paperclipai/plugin-sdk/bundlers\`.
- \`pnpm build:rollup\` uses rollup presets from the same SDK.
`,
  );

  writeFile(path.join(outputDir, ".gitignore"), "dist\nnode_modules\n.paperclip-sdk\n");

  return outputDir;
}

function parseArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

/** CLI wrapper for `scaffoldPluginProject`. */
function runCli() {
  const pluginName = process.argv[2];
  if (!pluginName) {
    // eslint-disable-next-line no-console
    console.error("Usage: create-paperclip-plugin <name> [--template default|connector|workspace] [--output <dir>] [--sdk-path <paperclip-sdk-path>] [--published]");
    process.exit(1);
  }

  const template = (parseArg("--template") ?? "default") as PluginTemplate;
  const outputRoot = parseArg("--output") ?? process.cwd();
  const targetDir = path.resolve(outputRoot, packageToDirName(pluginName));

  const out = scaffoldPluginProject({
    pluginName,
    outputDir: targetDir,
    template,
    displayName: parseArg("--display-name"),
    description: parseArg("--description"),
    author: parseArg("--author"),
    category: parseArg("--category") as ScaffoldPluginOptions["category"] | undefined,
    sdkPath: parseArg("--sdk-path"),
    publishedPackages: hasFlag("--published"),
  });

  // eslint-disable-next-line no-console
  console.log(`Created plugin scaffold at ${out}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli();
}
