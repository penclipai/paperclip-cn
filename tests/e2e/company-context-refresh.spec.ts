import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { createServer, type ViteDevServer } from "../../ui/node_modules/vite/dist/node/index.js";

let server: ViteDevServer;
let origin: string;
let cacheDir: string;
const uiRoot = path.resolve(import.meta.dirname, "../../ui");
const probeModuleId = "virtual:company-context-probe.tsx";
const resolvedProbeModuleId = `\0${probeModuleId}`;

// Use real Vite module instances and React contexts. Re-importing a refreshed
// consumer must still see a provider retained from the previous module version.
test.beforeAll(async () => {
  cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-company-context-vite-"));
  server = await createServer({
    root: uiRoot,
    cacheDir,
    configFile: false,
    resolve: { alias: { "@": path.join(uiRoot, "src") } },
    esbuild: { jsx: "automatic" },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "company-context-regression",
      resolveId(id) { if (id === probeModuleId) return resolvedProbeModuleId; },
      load(id) {
        if (id !== resolvedProbeModuleId) return;
        return `
          import React from "react";
          import { createRoot } from "react-dom/client";
          import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
          import { CompanyProvider, useCompany } from "/src/context/CompanyContext.tsx";
          const root = createRoot(document.getElementById("root"));
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          function render(hook, generation) {
            function Consumer() {
              return React.createElement("main", null, generation + ":" + (hook().selectedCompanyId ?? "loading"));
            }
            root.render(React.createElement(
              QueryClientProvider,
              { client },
              React.createElement(CompanyProvider, null, React.createElement(Consumer)),
            ));
          }
          render(useCompany, "initial");
          window.refreshConsumer = async () => {
            const refreshed = await import(/* @vite-ignore */ "/src/context/CompanyContext.tsx?t=" + Date.now());
            render(refreshed.useCompany, "refreshed");
          };
        `;
      },
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url !== "/") return next();
          res.setHeader("Content-Type", "text/html");
          res.end('<div id="root"></div><script type="module" src="/@vite/client"></script><script type="module" src="/@id/virtual:company-context-probe.tsx"></script>');
        });
      },
    }],
  });
  await server.listen();
  const address = server.httpServer!.address();
  if (!address || typeof address === "string") throw new Error("Missing test server address");
  origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await server?.close();
  if (cacheDir) await fs.rm(cacheDir, { recursive: true, force: true });
});

test("a refreshed company consumer reads the retained provider", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    const body = pathname === "/api/auth/get-session"
      ? { user: { id: "test-user" }, session: { userId: "test-user" } }
      : pathname === "/api/companies"
        ? [{ id: "test-company", name: "Test company", status: "active" }]
        : [];
    await route.fulfill({ json: body });
  });
  const diagnostics = {
    consoleErrors: [] as string[],
    pageErrors: [] as string[],
    requestFailures: [] as string[],
    httpFailures: [] as Array<{ status: number; url: string }>,
  };
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => { diagnostics.pageErrors.push(error.message); });
  page.on("requestfailed", (request) => {
    diagnostics.requestFailures.push(`${request.url()}: ${request.failure()?.errorText ?? "unknown failure"}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 400) {
      diagnostics.httpFailures.push({ status: response.status(), url: response.url() });
    }
  });

  try {
    await page.goto(origin);
    await expect(page.getByRole("main")).toHaveText("initial:test-company");
    await page.evaluate(() => (window as unknown as { refreshConsumer: () => Promise<void> }).refreshConsumer());
    await expect(page.getByRole("main")).toHaveText("refreshed:test-company");
    expect(diagnostics.pageErrors).toEqual([]);
  } catch (error) {
    const html = await page.content().catch(() => "");
    await test.info().attach("company-context-refresh-page.html", {
      body: html,
      contentType: "text/html",
    });
    await test.info().attach("company-context-refresh-diagnostics.json", {
      body: Buffer.from(JSON.stringify({ ...diagnostics, url: page.url() }, null, 2)),
      contentType: "application/json",
    });
    throw error;
  }
});
