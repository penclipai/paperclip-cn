# @penclipai/create-paperclip-plugin

Scaffolding tool for creating new Paperclip plugins.

```bash
npx @penclipai/create-paperclip-plugin my-plugin
```

Or with options:

```bash
npx @penclipai/create-paperclip-plugin @acme/my-plugin \
  --template connector \
  --category connector \
  --display-name "Acme Connector" \
  --description "Syncs Acme data into Paperclip" \
  --author "Acme Inc"
```

Supported templates: `default`, `connector`, `workspace`  
Supported categories: `connector`, `workspace`, `automation`, `ui`

Generates:
- typed manifest + worker entrypoint
- example UI widget using the supported `@paperclipai/plugin-sdk/ui` hooks
- test file using `@paperclipai/plugin-sdk/testing`
- `esbuild` and `rollup` config files using SDK bundler presets
- dev server script for hot-reload (`paperclip-plugin-dev-server`)

The scaffold intentionally uses plain React elements rather than host-provided UI kit components, because the current plugin runtime does not ship a stable shared component library yet.

Inside this repo, the generated package keeps compatibility imports from `@paperclipai/plugin-sdk*` and resolves them to the workspace packages published as `@penclipai/*`.

Outside this repo, the scaffold keeps those same compatibility imports and snapshots local compatibility tarballs into `.paperclip-sdk/` so the generated plugin can install immediately without waiting for npm publish.

If you want the generated package to target already-published npm artifacts instead, pass `--published`:

```bash
node packages/plugins/create-paperclip-plugin/dist/index.js @acme/my-plugin \
  --output /absolute/path/to/plugins \
  --sdk-path /absolute/path/to/paperclip/packages/plugins/sdk \
  --published
```

That keeps generated plugins compatible with both upstream Paperclip hosts and Penclip hosts without requiring dual-published packages.

## Workflow after scaffolding

```bash
cd my-plugin
pnpm install
pnpm dev       # watch worker + manifest + ui bundles
pnpm dev:ui    # local UI preview server with hot-reload events
pnpm test
```
