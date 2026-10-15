import { test, expect } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { listenOnFetchAllowedPort } from "../fetch-allowed-port";
import { pathToFileURL } from "node:url";

// Each attempt starts the source CLI with a fresh D: data directory. The model
// and MCP provider are deterministic fixtures; authorization/cards/wakes are real.
for (const journey of [
  "read_failure",
  "uncertain",
  "read_failure_restart",
  "ceo_lineage",
  "legacy_unknown",
] as const)
  test(`fresh execution recovery and current-request journey: ${journey}`, async ({
    page,
  }, info) => {
    const restartingReadFailure = journey === "read_failure_restart";
    test.setTimeout(
      process.platform === "win32" && restartingReadFailure ? 600_000 :
        process.platform === "win32" ? 300_000 : 180_000,
    );
    const readFailureJourney =
      journey === "read_failure" || journey === "read_failure_restart";
    const readyTimeout = process.platform === "win32" ? 180_000 : 100_000;
    const root = resolve(import.meta.dirname, "../../..");
    let processHandle: ChildProcess | undefined;
    let runtimeRoot: string | undefined;
    let cleanupState: Record<string, unknown> = {};
    let journeyCompleted = false;
    let lastStopConfirmed = false;
    let logs = "";
    const plainLogs = () => logs.replace(/\u001b\[[0-9;]*m/g, "");
    let diagnosticState = async () => ({});
    function windowsOwnedTree(pid: number) {
      const script = `$all=Get-CimInstance Win32_Process -ErrorAction Stop;$seen=@{${pid}=$true};do{$before=$seen.Count;$all|Where-Object {$seen.ContainsKey([int]$_.ParentProcessId)}|ForEach-Object {$seen[[int]$_.ProcessId]=$true}}while($seen.Count -gt $before);$all|Where-Object {$seen.ContainsKey([int]$_.ProcessId)}|Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='creationDate';e={$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json -Compress`;
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      const rows = JSON.parse(output || "[]");
      return (Array.isArray(rows) ? rows : [rows]) as Array<{
        pid: number;
        creationDate: string;
      }>;
    }
    function windowsTreeExited(snapshot: Array<{ pid: number; creationDate: string }>) {
      const pids = snapshot.map((entry) => entry.pid).join(",");
      const script = `Get-CimInstance Win32_Process -ErrorAction Stop|Where-Object {$_.ProcessId -in @(${pids})}|Select-Object @{n='pid';e={[int]$_.ProcessId}},@{n='creationDate';e={$_.CreationDate.ToUniversalTime().ToString('o')}}|ConvertTo-Json -Compress`;
      const output = execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
        encoding: "utf8",
        windowsHide: true,
      }).trim();
      const rows = JSON.parse(output || "[]");
      const current = (Array.isArray(rows) ? rows : [rows]) as Array<{
        pid: number;
        creationDate: string;
      }>;
      return snapshot.every((before) =>
        !current.some((after) => after.pid === before.pid && after.creationDate === before.creationDate),
      );
    }
    async function stopDrive() {
      lastStopConfirmed = false;
      if (processHandle?.pid) {
        const child = processHandle;
        let windowsTree: Array<{ pid: number; creationDate: string }> | null = null;
        if (process.platform === "win32") {
          try { windowsTree = windowsOwnedTree(child.pid); }
          catch { lastStopConfirmed = false; }
        }
        const stopped = new Promise<void>((done) =>
          child.once("exit", () => done()),
        );
        if (child.connected) {
          try { child.send({ type: "paperclip-e2e-shutdown" }, () => {}); } catch {}
          await Promise.race([
            stopped,
            new Promise<void>((done) => setTimeout(done, 15_000)),
          ]);
        }
        if (child.exitCode === null && child.signalCode === null) {
          try {
            if (process.platform === "win32") {
            // The foreground CLI owns this exact process tree. Windows does
            // not support POSIX process groups, so stop the owned tree before
            // a restart rather than leaving its embedded PostgreSQL behind.
            execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
              stdio: "ignore",
            });
            } else {
              process.kill(-child.pid!, "SIGTERM");
            }
          } catch {}
        }
        if (child.exitCode === null && child.signalCode === null) {
          let timeout: ReturnType<typeof setTimeout> | undefined;
          await Promise.race([
            stopped,
            new Promise<void>((done) => {
              timeout = setTimeout(() => {
                try {
                  if (process.platform === "win32") {
                    execFileSync(
                      "taskkill",
                      ["/PID", String(child.pid), "/T", "/F"],
                      {
                        stdio: "ignore",
                      },
                    );
                  } else {
                    process.kill(-child.pid!, "SIGKILL");
                  }
                } catch {}
                done();
              }, 15_000);
            }),
          ]);
          clearTimeout(timeout);
        }
        try {
          lastStopConfirmed = process.platform === "win32"
            ? Boolean(windowsTree?.some((entry) => entry.pid === child.pid && typeof entry.creationDate === "string"))
              && windowsTreeExited(windowsTree!)
            : (() => {
                try { process.kill(-child.pid!, 0); return false; }
                catch (error) { return (error as NodeJS.ErrnoException).code === "ESRCH"; }
              })();
        } catch {
          lastStopConfirmed = false;
        }
      } else lastStopConfirmed = true;
      return lastStopConfirmed;
    }
    async function hasReparsePoint(path: string): Promise<boolean> {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) return true;
      if (!stat.isDirectory()) return false;
      for (const entry of await readdir(path))
        if (await hasReparsePoint(resolve(path, entry))) return true;
      return false;
    }
    async function cleanupOwnedRuntimeRoot(stopped: boolean) {
      if (!runtimeRoot) return { retainedReason: "runtime_root_missing" };
      const parent = resolve(process.env.PAPERCLIP_E2E_TEMP_ROOT ?? tmpdir());
      if (dirname(runtimeRoot) !== parent || relative(parent, runtimeRoot).startsWith(".."))
        return { retainedReason: "outside_owned_parent" };
      try {
        const manifest = JSON.parse(await readFile(resolve(runtimeRoot, "owned-root.json"), "utf8"));
        if (!stopped) return { retainedReason: "owned_process_not_confirmed_stopped" };
        if (manifest.runtimeRoot !== runtimeRoot) return { retainedReason: "owned_manifest_mismatch" };
        if (await hasReparsePoint(runtimeRoot)) return { retainedReason: "reparse_point_detected" };
        await rm(runtimeRoot, { recursive: true, force: true });
        return { removed: true };
      } catch (error) {
        return { retainedReason: error instanceof Error ? error.message : "cleanup_guard_failed" };
      }
    }

    const calls: string[] = [];
    let gmailReadCount = 0;
    const fixture = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const part of req) chunks.push(Buffer.from(part));
      const message = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      const gmail = req.url === "/gmail";
      calls.push(`${gmail ? "gmail" : "notion"}:${message.method}`);
      if (message.id === undefined) {
        res.writeHead(202);
        res.end();
        return;
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: "2024-11-05",
              capabilities: { tools: {} },
              serverInfo: {
                name: gmail ? "gmail-fixture" : "heliotrope",
                version: "1",
              },
            }
          : message.method === "tools/list"
            ? {
                tools: [
                  {
                    name: gmail ? "gmail_read" : "archive_read",
                    description: gmail
                      ? "Read gmail-fixture launch email decisions"
                      : "Read heliotrope launch decisions",
                    annotations: { readOnlyHint: true, destructiveHint: false },
                    inputSchema: {
                      type: "object",
                      properties: {},
                      additionalProperties: false,
                    },
                  },
                ],
              }
            : message.method === "tools/call"
              ? {
                  content: [
                    {
                      type: "text",
                      text: gmail
                        ? ++gmailReadCount === 1 && journey !== "ceo_lineage"
                          ? journey !== "uncertain"
                            ? "RECOVERY-INJECT-SAFE"
                            : "RECOVERY-INJECT-UNKNOWN-WRITE"
                          : "GMAIL-73: The launch email confirms Friday approval. Source: https://example.invalid/mail/gmail-73"
                        : "HELIOTROPE-42: Launch in two stages; support handoff belongs to Mira. Source: https://example.invalid/launch/heliotrope-42",
                    },
                  ],
                }
              : {};
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
    try {
      const port = await listenOnFetchAllowedPort(fixture);
      runtimeRoot = resolve(
        process.env.PAPERCLIP_E2E_TEMP_ROOT ?? tmpdir(),
        randomUUID().slice(0, 12),
      );
      const testDriveDataDir = resolve(runtimeRoot, "paperclip-home");
      const emptyCodexHome = resolve(runtimeRoot, "empty-codex-home");
      const fixtureCodexEntry = resolve(
        root,
        "tests/e2e/fixtures/in-feed-codex.mjs",
      );
      const fixtureCodexLoader = resolve(
        root,
        "tests/e2e/fixtures/recovery-codex-loader.mjs",
      );
      const shutdownHelper = resolve(
        root,
        "tests/e2e/fixtures/native-test-drive-shutdown.mjs",
      );
      await mkdir(runtimeRoot, { recursive: true });
      await writeFile(
        resolve(runtimeRoot, "owned-root.json"),
        `${JSON.stringify({
          journey,
          runtimeRoot,
          testDriveDataDir,
          provider: {
            command: process.execPath,
            args: [fixtureCodexEntry, "--recovery-fixture"],
          },
        })}\n`,
      );
      await mkdir(emptyCodexHome, { recursive: true });
      const env = {
        ...process.env,
        PAPERCLIP_RECOVERY_CEO_LINEAGE: journey === "ceo_lineage" ? "1" : "0",
        IN_FEED_FIXTURE_KEY: "not-a-real-model-key",
        IN_FEED_TEST_DRIVE_SHUTDOWN: "1",
        NODE_ENV: "test",
        PAPERCLIP_RECOVERY_CODEX_ENTRY: fixtureCodexEntry,
        PAPERCLIP_RECOVERY_FIXTURE: "1",
        PAPERCLIP_HOME: testDriveDataDir,
        CODEX_HOME: emptyCodexHome,
        HOME: runtimeRoot,
        TEMP: runtimeRoot,
        TMP: runtimeRoot,
        TMPDIR: runtimeRoot,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(fixtureCodexLoader).href} --import=${pathToFileURL(shutdownHelper).href}`,
        PAPERCLIP_VITE_CACHE_DIR: resolve(runtimeRoot, "vite-cache"),
      };
      delete env.DATABASE_URL;
      delete env.DATABASE_MIGRATION_URL;
      processHandle = spawn(
        process.execPath,
        [
          "cli/node_modules/tsx/dist/cli.mjs",
          "cli/src/index.ts",
          "test-drive",
          "--harness",
          "codex",
          "--api-key-env",
          "IN_FEED_FIXTURE_KEY",
          "--company-name",
          "Execution recovery fixture",
          "--data-dir",
          testDriveDataDir,
          "--no-browser",
        ],
        { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
      );
      processHandle.stdout!.on("data", (chunk) => {
        logs += chunk.toString();
      });
      processHandle.stderr!.on("data", (chunk) => {
        logs += chunk.toString();
      });
      await expect
        .poll(
          () =>
            plainLogs().match(
              /Paperclip is ready at (http:\/\/127\.0\.0\.1:\d+)/,
            )?.[1],
          { timeout: readyTimeout },
        )
        .toBeTruthy();
      let base = plainLogs().match(
        /Paperclip is ready at (http:\/\/127\.0\.0\.1:\d+)/,
      )![1]!;
      const api = async (path: string, method = "GET", data?: unknown) => {
        const response = await page.request.fetch(`${base}/api${path}`, {
          method,
          data,
        });
        expect(response.ok(), await response.text()).toBeTruthy();
        return response.json();
      };
      const isSettledRun = (run: { status: string; errorCode?: string }) =>
        run.status === "succeeded" ||
        (run.status === "cancelled" &&
          run.errorCode === "issue_not_in_progress");
      const expectedHealth = {
        status: "ok",
        deploymentMode: "local_trusted",
        bootstrapStatus: "ready",
        serverInfo: {
          git: {
            branchName: execFileSync("git", ["branch", "--show-current"], {
              cwd: root,
              encoding: "utf8",
            }).trim(),
          },
        },
      };
      await expect
        .poll(
          async () => {
            const response = await page.request.get(`${base}/api/health`);
            return response.ok() ? response.json() : null;
          },
          { timeout: 100_000 },
        )
        .toMatchObject(expectedHealth);
      const health = await api("/health");
      const existingCompanies = await api("/companies");
      expect(existingCompanies).toHaveLength(1);
      const company = existingCompanies[0]!;
      let [agent] = await api(`/companies/${company.id}/agents`);
      if (!agent) {
        // `test-drive` normally seeds the same fixture before the ready
        // banner. Keep this equivalent API path for an initialized fallback.
        await api(`/companies/${company.id}/user-secret-definitions`, "POST", {
          key: "OPENAI_API_KEY",
          name: "OpenAI API Key",
        });
        await api(`/companies/${company.id}/me/user-secrets`, "POST", {
          definitionKey: "OPENAI_API_KEY",
          value: "not-a-real-model-key",
        });
        agent = await api(`/companies/${company.id}/agents`, "POST", {
          name: "CEO",
          role: "ceo",
          adapterType: "codex_local",
          adapterConfig: {
            env: {
              OPENAI_API_KEY: {
                type: "user_secret_ref",
                key: "OPENAI_API_KEY",
                version: "latest",
                required: true,
              },
            },
          },
        });
      }
      expect(agent.adapterType).toBe("codex_local");
      expect(await api(`/companies/${company.id}/issues`)).toEqual([]);
      expect(await api(`/companies/${company.id}/heartbeat-runs`)).toEqual([]);
      expect(
        (await api(`/companies/${company.id}/tools/connections`)).connections,
      ).toEqual([]);
      diagnosticState = async () => ({
        base,
        companyId: company.id,
        agentId: agent.id,
        tasks: (await api(`/companies/${company.id}/issues`)).map(
          (task: Record<string, unknown>) => ({
            id: task.id,
            status: task.status,
            assigneeAgentId: task.assigneeAgentId,
          }),
        ),
        runs: (await api(`/companies/${company.id}/heartbeat-runs`)).map(
          (run: Record<string, unknown>) => ({
            id: run.id,
            status: run.status,
            runtimeMode: run.runtimeMode,
            error: run.error,
            errorCode: run.errorCode,
          }),
        ),
      });
      const dataDir = testDriveDataDir;
      await writeFile(
        info.outputPath("running-instance.json"),
        JSON.stringify(
          { base, dataDir, companyId: company.id, agentId: agent.id },
          null,
          2,
        ),
      );
      const prefix = `/${company.issuePrefix}`;
      await page.addInitScript(() => {
        window.localStorage.setItem("paperclip.locale", "en");
      });
      await page.goto(base + prefix + "/dashboard");
      await expect(page.getByText("No runs yet").first()).toBeVisible({
        timeout: 30_000,
      });
      if (journey === "legacy_unknown") {
        agent = await api(`/companies/${company.id}/agents`, "POST", {
          name: "Legacy executor",
          role: "engineer",
          adapterType: "process",
          adapterConfig: {
            command: process.execPath,
            args: [
              "-e",
              "console.error('Deterministic provider failure; no recoverable session contract'); process.exit(1)",
            ],
          },
        });
        await page.getByRole("link", { name: "Tasks", exact: true }).click();
        await page
          .getByRole("button", { name: "New Task", exact: true })
          .last()
          .click();
        await page
          .getByRole("textbox", { name: "Editable markdown" })
          .fill("Read the legacy fixture report");
        await page
          .getByRole("button", { name: "Select assignee", exact: true })
          .click();
        await page.getByRole("option").filter({ hasText: agent.name }).click();
        await expect(
          page.getByRole("searchbox", {
            name: "Search assignees",
            includeHidden: true,
          }),
        ).toHaveCount(0);
        await page
          .getByRole("button", { name: "Create task", exact: true })
          .click();
        await page
          .getByRole("complementary")
          .getByRole("link", { name: /Read the legacy fixture report/ })
          .click();
        await expect
          .poll(
            async () => {
              const tasks = await api(`/companies/${company.id}/issues`);
              return tasks.find(
                (issue: { title: string }) =>
                  issue.title === "Read the legacy fixture report",
              )?.status;
            },
            { timeout: 60_000 },
          )
          .toBe("blocked");
        await expect(
          page.getByTestId("issue-detail-header").getByRole("button", {
            name: /Change status \(current: Blocked · 0 blockers need attention\)/,
          }),
        ).toBeVisible({ timeout: 30_000 });
        await expect(
          page.getByRole("button", { name: "Reconcile and continue" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("button", { name: "Try again", exact: true }),
        ).toHaveCount(0);
        const composer = page.locator('[contenteditable="true"]').last();
        await composer.fill("Independent draft remains usable");
        await expect(composer).toContainText(
          "Independent draft remains usable",
        );
        await page.screenshot({
          path: info.outputPath("legacy-recovery-needed.png"),
          fullPage: true,
        });
        // Observe past the shared retry delay; absence of a successor is part
        // of the fail-closed contract, not merely a momentary UI state.
        await page.waitForTimeout(35_000);
        const runs = await api(`/companies/${company.id}/heartbeat-runs`);
        expect(runs).toHaveLength(1);
        expect(await api(`/heartbeat-runs/${runs[0].id}`)).toMatchObject({
          runtimeMode: "legacy",
          status: "failed",
        });
        await page.reload();
        await expect(
          page.getByRole("button", { name: "Reconcile and continue" }),
        ).toHaveCount(0);
        await writeFile(
          info.outputPath("instance-and-runs.json"),
          JSON.stringify(
            {
              base,
              dataDir,
              health,
              dependency: "deterministic legacy process fixture",
              companyId: company.id,
              agentId: agent.id,
              runs,
            },
            null,
            2,
          ),
        );
        return;
      }
      await page.goto(
        base + prefix + "/company/settings/instance/experimental",
      );
      const nativeRunnerToggle = page.getByRole("switch", {
        name: "Toggle Paperclip Runner experimental setting",
      });
      // Fresh instances may already enable the native runner. Configure the
      // desired state instead of blindly toggling the current default off.
      if ((await nativeRunnerToggle.getAttribute("aria-checked")) !== "true") {
        await nativeRunnerToggle.click();
      }
      await expect(nativeRunnerToggle).toHaveAttribute("aria-checked", "true");
      await expect
        .poll(
          async () =>
            (await api("/instance/settings/experimental")).enableNativeRunner,
        )
        .toBe(true);
      const agentRuntimeUrl = base + prefix + `/agents/${agent.urlKey}/runtime`;
      await page.goto(agentRuntimeUrl);
      await expect(page).toHaveURL(agentRuntimeUrl);
      await page.getByRole("button", { name: "Codex", exact: true }).click();
      await page.getByRole("button", { name: /Paperclip Runner/ }).click();
      await page
        .getByRole("button", { name: /^Save(?: changes)?$/ })
        .first()
        .click();
      await expect
        .poll(async () => (await api(`/agents/${agent.id}`)).adapterType)
        .toBe("paperclip_runner");
      // The source test-drive serves Vite. Reload after the runtime bundle is
      // first mounted so a one-time dependency optimizer refresh cannot reset
      // the subsequent connector form mid-journey.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(agentRuntimeUrl);
      const nativeAgent = await api(`/agents/${agent.id}`);
      expect(nativeAgent.adapterConfig.env).toEqual(agent.adapterConfig.env);
      if (journey !== "ceo_lineage") {
        const { instructionsFilePath: _instructions, ...executorConfig } =
          nativeAgent.adapterConfig;
        agent = await api(`/companies/${company.id}/agents`, "POST", {
          name: "Executor",
          role: "engineer",
          adapterType: "paperclip_runner",
          adapterConfig: executorConfig,
        });
      }
      await api(
        `/agents/${agent.id}/skills/sync?companyId=${company.id}`,
        "POST",
        { desiredSkills: [], mode: "replace" },
      );
      const skillSnapshot = await api(
        `/agents/${agent.id}/skills?companyId=${company.id}`,
      );
      expect(skillSnapshot.desiredSkills).toEqual([]);
      const holder = await api(`/companies/${company.id}/agents`, "POST", {
        name: "Archive holder",
        role: "qa",
        adapterType: "process",
        adapterConfig: {
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
      });
      const connections: Record<string, { id: string; name: string }> = {};
      for (const service of ["notion", "gmail"]) {
        // Vite may finish its first dependency optimization by reloading the
        // page here. Wait for the navigation response only; the role locators
        // below still prove that the Apps UI has loaded before interaction.
        await page.goto(base + prefix + "/apps", { waitUntil: "commit" });
        const custom = page
          .getByRole("list", { name: "Connector list" })
          .getByRole("listitem")
          .filter({ hasText: "Connect your own tool" });
        await custom
          .getByRole("button", { name: "Connect", exact: true })
          .click();
        await custom
          .getByRole("button", { name: "Connect your own MCP server" })
          .click();
        await page
          .getByPlaceholder("https://example.com/actions")
          .fill(`http://127.0.0.1:${port}/${service}`);
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await page.getByRole("button", { name: "Change", exact: true }).click();
        await page.getByRole("radio", { name: "Just agents I pick" }).click();
        await page.getByRole("button", { name: /Select agents/ }).click();
        await page.getByRole("checkbox", { name: /Archive holder/ }).check();
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: /Check link/i }).click();
        await expect(
          page.getByRole("heading", { name: /is ready/i }),
        ).toBeVisible({ timeout: 30_000 });
        const connection = (
          await api(`/companies/${company.id}/tools/connections`)
        ).connections.find(
          (row: { id: string }) =>
            !Object.values(connections).some(
              (existing) => existing.id === row.id,
            ),
        );
        connections[service] = connection;
        const installs = (
          await api(`/tool-connections/${connection.id}/installs`)
        ).installs;
        expect(installs).toEqual([
          expect.objectContaining({ targetId: holder.id }),
        ]);
      }
      await page.getByRole("link", { name: "Tasks", exact: true }).click();
      await page
        .getByRole("button", { name: "New Task", exact: true })
        .last()
        .click();
      await page
        .getByRole("textbox", { name: "Editable markdown" })
        .fill(
          `${journey === "ceo_lineage" ? "CEO descendant fixture: " : ""}Find the heliotrope launch notes and summarize the decisions with a source link`,
        );
      await page
        .getByRole("button", { name: "Select assignee", exact: true })
        .click();
      await page.getByRole("option").filter({ hasText: agent.name }).click();
      await expect(
        page.getByRole("searchbox", {
          name: "Search assignees",
          includeHidden: true,
        }),
      ).toHaveCount(0);
      await page
        .getByRole("button", { name: "Create task", exact: true })
        .click();
      await page
        .getByRole("complementary")
        .getByRole("link", { name: /Find the heliotrope launch notes/ })
        .click();
      await expect(page).toHaveURL(/issues\/(?:[a-f0-9-]+|[A-Z]+-\d+)/);
      const connectPending = async (
        service: "notion" | "gmail",
        priorRunIds = new Set<string>(),
      ) => {
        const connection = connections[service]!;
        const card = page
          .getByTestId("connection-intent-focus-target")
          .filter({ hasText: connection.name });
        await expect(
          card.getByRole("button", { name: "Grant access", exact: true }),
        ).toBeVisible({ timeout: 60_000 });
        await page.screenshot({
          path: info.outputPath(`${service}-pending.png`),
          fullPage: true,
        });
        await card
          .getByRole("button", { name: "Grant access", exact: true })
          .click();
        await expect(card.getByText(/access granted$/i)).toBeVisible({
          timeout: 30_000,
        });
        const approval = page.getByRole("region", {
          name: "Approve tool action",
        });
        expect(new URL(page.url()).pathname).toMatch(
          /\/issues\/(?:[a-f0-9-]+|[A-Z]+-\d+)/,
        );
        const expectedTool =
          service === "notion" ? "archive_read" : "gmail_read";
        if (service === "gmail" && journey === "ceo_lineage") {
          // CEO lineage uses a configured read-only Gmail tool. The completed
          // response proves the real direct-read path instead of inventing a
          // governed-action approval that policy did not render.
          await expect(
            page
              .getByText(/GMAIL-73: The launch email confirms Friday approval/)
              .first(),
          ).toBeVisible({ timeout: 60_000 });
          expect(gmailReadCount).toBe(1);
          return;
        }
        const directGmailRecovery = service === "gmail";

        if (directGmailRecovery) {
          // The recovery fixture deliberately consumes the first Gmail read and
          // then emits its checkpoint fault. Current read-only policy may allow
          // that call without rendering an approval card. Wait for either a
          // scoped card, or the exact failed terminal recorded for this new
          // Gmail run; do not manufacture an approval interaction.
          let outcome: "approval" | "failed-terminal" | null = null;
          await expect
            .poll(
              async () => {
                if (
                  (await approval.count()) === 1 &&
                  (await approval.textContent())?.includes(expectedTool) &&
                  (await approval
                    .getByRole("button", {
                      name: "Approve & run",
                      exact: true,
                    })
                    .count()) === 1
                ) {
                  outcome = "approval";
                  return outcome;
                }

                const runs = await api(
                  `/companies/${company.id}/heartbeat-runs`,
                );
                const failed = runs.filter(
                  (run: { id: string; status: string }) =>
                    !priorRunIds.has(run.id) && run.status === "failed",
                );
                if (failed.length !== 1 || gmailReadCount !== 1) {
                  outcome = null;
                  return outcome;
                }
                const events = await api(
                  `/heartbeat-runs/${failed[0]!.id}/events`,
                );
                const terminal = events.find(
                  (event: {
                    eventType?: string;
                    payload?: {
                      prpEvent?: { payload?: { error?: { code?: string } } };
                    };
                  }) =>
                    event.eventType === "turn.failed" &&
                    event.payload?.prpEvent?.payload?.error?.code ===
                      "fixture_checkpoint_unusable",
                );
                outcome = terminal ? "failed-terminal" : null;
                return outcome;
              },
              { timeout: 60_000 },
            )
            .not.toBeNull();

          if (outcome === "failed-terminal") {
            expect(gmailReadCount).toBe(1);
            return;
          }
        }

        // The configured MCP tools are user-gated when the service exposes a
        // scoped approval card. The card and tool name must match exactly.
        await expect(approval).toContainText(expectedTool, { timeout: 30_000 });
        await expect(
          approval.getByRole("button", { name: "Approve & run", exact: true }),
        ).toBeVisible({ timeout: 30_000 });
        await approval
          .getByRole("button", { name: "Approve & run", exact: true })
          .click();
      };
      if (journey === "ceo_lineage")
        await expect(
          page
            .getByText("Provider child finished; root execution continues.", {
              exact: true,
            })
            .first(),
        ).toBeVisible({ timeout: 60_000 });
      await connectPending("notion");
      await expect(
        page.getByText(/HELIOTROPE-42: Launch in two stages/).first(),
      ).toBeVisible({ timeout: 60_000 });
      await expect
        .poll(
          async () =>
            (await api(`/companies/${company.id}/heartbeat-runs`)).every(
              isSettledRun,
            ),
          { timeout: 60_000 },
        )
        .toBe(true);
      const [task] = await api(`/companies/${company.id}/issues`);
      const originalTitle = task.title;
      await page
        .getByRole("textbox")
        .last()
        .fill(
          "Now summarize my Gmail emails about launch decisions, with the source link.",
        );
      const gmailPriorRunIds = new Set(
        (await api(`/companies/${company.id}/heartbeat-runs`)).map(
          (run: { id: string }) => run.id,
        ),
      );
      await page.getByRole("button", { name: "Send", exact: true }).click();
      await connectPending("gmail", gmailPriorRunIds);
      if (journey === "read_failure_restart") {
        await expect
          .poll(
            async () =>
              (await api(`/companies/${company.id}/heartbeat-runs`)).every(
                (run: { status: string }) =>
                  !["running", "queued", "scheduled_retry"].includes(run.status),
              ),
            { timeout: 60_000 },
          )
          .toBe(true);
        await page.screenshot({
          path: info.outputPath("retry-before-restart.png"),
          fullPage: true,
        });
        await stopDrive();
        processHandle = spawn(
          process.execPath,
          [
            "cli/node_modules/tsx/dist/cli.mjs",
            "cli/src/index.ts",
            "test-drive",
            "--data-dir",
            dataDir,
            "--harness",
            "codex",
            "--api-key-env",
            "IN_FEED_FIXTURE_KEY",
            "--no-browser",
          ],
          { cwd: root, env, detached: true, stdio: ["ignore", "pipe", "pipe", "ipc"] },
        );
        processHandle.stdout!.on("data", (chunk) => {
          logs += chunk.toString();
        });
        processHandle.stderr!.on("data", (chunk) => {
          logs += chunk.toString();
        });
        await expect
          .poll(
            async () => {
              const response = await page.request
                .get(`${base}/api/health`)
                .catch(() => null);
              return response?.ok() ? base : null;
            },
            { timeout: readyTimeout },
          )
          .toBeTruthy();
        expect((await api("/health")).serverInfo.git.branchName).toBe(
          health.serverInfo.git.branchName,
        );
        expect((await api("/companies"))[0].id).toBe(company.id);
        await page.goto(base + prefix + `/issues/${task.id}`);
      }
      const composer = page.getByRole("textbox").last();
      await composer.fill("An unsent draft stays available during recovery.");
      await expect(composer).toBeEditable();
      if (journey === "ceo_lineage") {
        await expect(
          page
            .getByText(/GMAIL-73: The launch email confirms Friday approval/)
            .first(),
        ).toBeVisible({ timeout: 100_000 });
        expect(gmailReadCount).toBe(journey === "ceo_lineage" ? 1 : 2);
      } else if (journey === "uncertain") {
        await expect
          .poll(async () => (await api(`/issues/${task.id}`)).status, {
            timeout: 100_000,
          })
          .toBe("blocked");
        await expect(
          page.getByTestId("issue-detail-header").getByRole("button", {
            name: /Change status \(current: Blocked · 0 blockers need attention\)/,
          }),
        ).toBeVisible({ timeout: 30_000 });
        expect(gmailReadCount).toBe(1);
        await expect(page.getByText(/GMAIL-73/)).toHaveCount(0);
        await expect(
          page.getByRole("button", {
            name: /Reconcile and continue|Try again/,
          }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("dialog", { name: "Reconcile execution" }),
        ).toHaveCount(0);
        const recovery = (await api(`/issues/${task.id}`)).activeRecoveryAction;
        expect(recovery).toMatchObject({
          kind: "active_run_watchdog",
          ownerType: "board",
          cause: "native_continuation_requires_reconciliation",
          status: "active",
          nextAction:
            "Inspect the original failure and reconcile the previous execution before continuing. Automatic recovery cannot start another incident.",
        });
        await page.screenshot({
          path: info.outputPath("uncertain-automatic-no-replay.png"),
          fullPage: true,
        });
        // Past the retry delay, unknown effects still cannot be replayed.
        await page.waitForTimeout(35_000);
        expect(gmailReadCount).toBe(1);
      } else if (readFailureJourney) {
        // The provider already received the read-only Gmail result. Its
        // terminal meaning is unclassified, so recovery must remain
        // fail-closed instead of invoking Gmail again or scheduling a retry.
        expect(gmailReadCount).toBe(1);
        await expect(page.getByText(/GMAIL-73/)).toHaveCount(0);
        await page.waitForTimeout(35_000);
        expect(gmailReadCount).toBe(1);
      }
      await expect(composer).toHaveText(
        "An unsent draft stays available during recovery.",
      );
      await expect
        .poll(
          async () =>
            (await api(`/companies/${company.id}/heartbeat-runs`)).every(
              (run: { status: string }) =>
                !["running", "queued", "scheduled_retry"].includes(run.status),
            ),
          { timeout: 60_000 },
        )
        .toBe(true);
      if (journey === "ceo_lineage")
        await expect(async () => {
          const answer = page
            .getByText(/GMAIL-73: The launch email confirms Friday approval/)
            .first();
          // Refresh can replace the streamed row with its persisted transcript.
          // Re-resolve the locator if that handoff detaches it during scrolling.
          await answer.scrollIntoViewIfNeeded();
          await expect(answer).toBeInViewport();
        }).toPass({ timeout: 10_000 });
      await page.screenshot({
        path: info.outputPath(`${journey}-outcome.png`),
        fullPage: true,
      });
      const finalRuns = await Promise.all(
        (await api(`/companies/${company.id}/heartbeat-runs`)).map(
          (run: { id: string }) => api(`/heartbeat-runs/${run.id}`),
        ),
      );
      const replacements = finalRuns.filter(
        (run: { scheduledRetryReason?: string }) =>
          run.scheduledRetryReason === "native_safe_replacement",
      );
      expect(replacements).toHaveLength(0);
      expect(
        finalRuns.every(
          (run: { runtimeMode: string }) => run.runtimeMode === "native",
        ),
      ).toBe(true);
      expect(
        finalRuns.some((run: { status: string }) => run.status === "running"),
      ).toBe(false);
      expect((await api(`/issues/${task.id}`)).title).toBe(originalTitle);
      await composer.fill("");
      await page.reload();
      await expect(page.getByText(/Due now/, { exact: true })).toHaveCount(0);
      if (journey === "ceo_lineage")
        await expect(
          page
            .getByText(/GMAIL-73: The launch email confirms Friday approval/)
            .first(),
        ).toBeVisible();
      else if (journey === "uncertain") {
        expect((await api(`/issues/${task.id}`)).status).toBe("blocked");
        await expect(
          page.getByRole("button", { name: "Reconcile and continue" }),
        ).toHaveCount(0);
      }
      if (journey === "ceo_lineage")
        await expect(async () => {
          const answer = page
            .getByText(/GMAIL-73: The launch email confirms Friday approval/)
            .first();
          // Refresh can replace the streamed row with its persisted transcript.
          // Re-resolve the locator if that handoff detaches it during scrolling.
          await answer.scrollIntoViewIfNeeded();
          await expect(answer).toBeInViewport();
        }).toPass({ timeout: 10_000 });
      await page.screenshot({
        path: info.outputPath(`${journey}-after-refresh.png`),
        fullPage: true,
      });
      const evidence = JSON.stringify(
        {
          base,
          dataDir,
          health,
          journey,
          companyId: company.id,
          agentId: agent.id,
          taskId: task.id,
          connections,
          runs: finalRuns.map((run: Record<string, unknown>) => ({
            id: run.id,
            runtimeMode: run.runtimeMode,
            status: run.status,
            retryOfRunId: run.retryOfRunId,
            errorCode: run.errorCode,
            execution: run.execution,
          })),
          dependency: "fixture",
          provider: "codex",
          fixtureModel: "in-feed-fixture",
          calls,
        },
        null,
        2,
      );
      await writeFile(info.outputPath("instance-and-runs.json"), evidence);
      await info.attach("instance-and-runs", {
        body: evidence,
        contentType: "application/json",
      });
      journeyCompleted = true;
    } finally {
      let evidencePreserved = false;
      let preservationError: string | undefined;
      try {
        if (!runtimeRoot) throw new Error("owned runtime root is missing");
        const manifestPath = resolve(runtimeRoot, "owned-root.json");
        if ((await lstat(runtimeRoot)).isSymbolicLink() || (await lstat(manifestPath)).isSymbolicLink())
          throw new Error("owned evidence contains a reparse point");
        await writeFile(info.outputPath("owned-root.json"), await readFile(manifestPath));
        await writeFile(
          info.outputPath("diagnostics.json"),
          JSON.stringify(await diagnosticState().catch(() => ({})), null, 2),
        );
        await writeFile(info.outputPath("test-drive.log"), logs);
        evidencePreserved = true;
      } catch (error) {
        preservationError = error instanceof Error ? error.message : "evidence preservation failed";
      } finally {
        try {
          await stopDrive();
        } finally {
          fixture.closeAllConnections();
          await new Promise<void>((done) => fixture.close(() => done()));
          // Keep the complete owned runtime for a failed journey; successful
          // journeys already preserved their API evidence, manifest and logs.
          cleanupState = journeyCompleted && evidencePreserved
            ? await cleanupOwnedRuntimeRoot(lastStopConfirmed)
            : { retainedReason: journeyCompleted ? "evidence_preservation_failed" : "failed_journey_runtime_evidence_retained", preservationError };
          try {
            await writeFile(
              info.outputPath("runtime-cleanup.json"),
              JSON.stringify(cleanupState, null, 2),
            );
          } catch {}
        }
      }
    }
  });
