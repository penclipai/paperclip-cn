import { expect, test, type Page } from "@playwright/test";
import { localized } from "../e2e/localized-selectors";

const ADMIN_EMAIL =
  process.env.PAPERCLIP_RELEASE_SMOKE_EMAIL ??
  process.env.SMOKE_ADMIN_EMAIL ??
  "smoke-admin@paperclip.local";
const ADMIN_PASSWORD =
  process.env.PAPERCLIP_RELEASE_SMOKE_PASSWORD ??
  process.env.SMOKE_ADMIN_PASSWORD ??
  "paperclip-smoke-password";

const COMPANY_NAME = `Release-Smoke-${Date.now()}`;
const AGENT_NAME = "CEO";
const MISSION =
  "Verify that the published Docker image can complete onboarding.";
const FIRST_TASK_TITLE =
  /^(Hire your first engineer and create a hiring plan|招聘首位工程师并制定招聘计划)$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function installPortableAgentRoutes(page: Page) {
  await page.route("**/test-environment", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        adapterType: "claude_local",
        status: "pass",
        checks: [
          {
            code: "release_smoke_portable_adapter",
            level: "info",
            message:
              "Release smoke uses a portable process adapter for the first heartbeat.",
          },
        ],
        testedAt: new Date().toISOString(),
      }),
    })
  );

  await page.route("**/agent-hires", async (route) => {
    const request = route.request();
    const headers = await request.allHeaders();
    const body = JSON.parse(request.postData() || "{}") as Record<
      string,
      unknown
    >;
    const runtimeConfig = asRecord(body.runtimeConfig);
    const heartbeat = asRecord(runtimeConfig.heartbeat);
    const forwardedHeaders: Record<string, string> = {
      ...headers,
      "content-type": "application/json",
    };
    delete forwardedHeaders.host;
    delete forwardedHeaders["content-length"];

    const response = await fetch(request.url(), {
      method: "POST",
      headers: forwardedHeaders,
      body: JSON.stringify({
        ...body,
        adapterType: "process",
        adapterConfig: {
          command: "node",
          args: ["-e", "console.log('release smoke heartbeat')"],
          timeoutSec: 20,
        },
        runtimeConfig: {
          ...runtimeConfig,
          heartbeat: {
            ...heartbeat,
            wakeOnDemand: true,
            cooldownSec: 0,
          },
        },
      }),
    });

    await route.fulfill({
      status: response.status,
      contentType: response.headers.get("content-type") ?? "application/json",
      body: await response.text(),
    });
  });
}

async function signIn(page: Page) {
  await page.goto("/");
  await expect(page).toHaveURL(/\/auth/);

  await page.locator('input[type="email"]').fill(ADMIN_EMAIL);
  await page.locator('input[type="password"]').fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /^(Sign In|登录)$/ }).click();

  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function openOnboarding(page: Page) {
  await page.goto("/onboarding");

  const wizardHeading = page.getByRole("heading", {
    name: localized.nameYourTeam,
  });
  const startButton = page.getByRole("button", {
    name: /^(Start Onboarding|New Company|开始引导|新建公司)$/i,
  });
  const buildNewTeamButton = page.getByRole("button", {
    name: localized.buildNewTeam,
  });

  await Promise.any([
    wizardHeading.waitFor({ state: "visible", timeout: 20_000 }),
    startButton.waitFor({ state: "visible", timeout: 20_000 }),
    buildNewTeamButton.waitFor({ state: "visible", timeout: 20_000 }),
  ]);

  if (!(await wizardHeading.isVisible())) {
    if (await startButton.isVisible()) {
      await startButton.click();
    }
  }
  if (
    !(await wizardHeading.isVisible()) &&
    (await buildNewTeamButton.isVisible())
  ) {
    await buildNewTeamButton.click();
  }

  await expect(wizardHeading).toBeVisible({ timeout: 10_000 });
}

test.describe("Docker authenticated onboarding smoke", () => {
  test("logs in, completes onboarding, and hires the lead agent", async ({
    page,
  }) => {
    await installPortableAgentRoutes(page);
    await signIn(page);
    await openOnboarding(page);

    await page.getByPlaceholder("Acme Corp").fill(COMPANY_NAME);
    await page.getByRole("button", { name: localized.next }).click();

    // Step 2: define the mission directly; confirming creates the company.
    await expect(
      page.getByRole("heading", { name: localized.defineMission })
    ).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder(localized.missionPlaceholder).fill(MISSION);
    await page.getByRole("button", { name: localized.confirmMission }).click();

    const leadName = page.getByPlaceholder(localized.chiefOfStaffPlaceholder);
    await leadName.waitFor({ timeout: 30_000 });
    await leadName.fill(AGENT_NAME);
    await page.getByRole("button", { name: localized.next }).click();

    await page
      .getByRole("button", { name: localized.giveItAHeartbeat })
      .click();

    const getStarted = page.getByRole("button", { name: localized.getStarted });
    await getStarted.waitFor({ timeout: 30_000 });

    await getStarted.click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    const baseUrl = new URL(page.url()).origin;

    const companiesRes = await page.request.get(`${baseUrl}/api/companies`);
    expect(companiesRes.ok()).toBe(true);
    const companies = (await companiesRes.json()) as Array<{ id: string; name: string }>;
    const company = companies.find((entry) => entry.name === COMPANY_NAME);
    expect(company).toBeTruthy();

    const agentsRes = await page.request.get(
      `${baseUrl}/api/companies/${company!.id}/agents`
    );
    expect(agentsRes.ok()).toBe(true);
    const agents = (await agentsRes.json()) as Array<{
      id: string;
      name: string;
      role: string;
      adapterType: string;
    }>;
    const ceoAgent = agents.find((entry) => entry.name === AGENT_NAME);
    expect(ceoAgent).toBeTruthy();
    expect(ceoAgent!.role).toBe("ceo");
    expect(ceoAgent!.adapterType).toBe("process");

    const goalsRes = await page.request.get(
      `${baseUrl}/api/companies/${company!.id}/goals`
    );
    expect(goalsRes.ok()).toBe(true);
    const goals = (await goalsRes.json()) as Array<{
      id: string;
      title: string;
      level: string;
      status: string;
    }>;
    expect(goals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: MISSION,
          level: "company",
          status: "active",
        }),
      ])
    );

    const issuesRes = await page.request.get(
      `${baseUrl}/api/companies/${company!.id}/issues`
    );
    expect(issuesRes.ok()).toBe(true);
    const issues = (await issuesRes.json()) as Array<{
      id: string;
      title: string;
      assigneeAgentId: string | null;
    }>;
    const issue = issues.find((entry) => FIRST_TASK_TITLE.test(entry.title));
    expect(issue).toBeTruthy();
    expect(issue!.assigneeAgentId).toBe(ceoAgent!.id);

    await expect.poll(
      async () => {
        const runsRes = await page.request.get(
          `${baseUrl}/api/companies/${company!.id}/heartbeat-runs?agentId=${ceoAgent!.id}`
        );
        expect(runsRes.ok()).toBe(true);
        const runs = (await runsRes.json()) as Array<{
          agentId: string;
          invocationSource: string;
          status: string;
        }>;
        const latestRun = runs.find((entry) => entry.agentId === ceoAgent!.id);
        return latestRun
          ? {
              invocationSource: latestRun.invocationSource,
              status: latestRun.status,
            }
          : null;
      },
      {
        timeout: 45_000,
        intervals: [1_000, 2_000, 5_000],
      }
    ).toEqual(
      expect.objectContaining({
        invocationSource: "assignment",
        status: expect.stringMatching(/^(queued|running|succeeded|failed)$/),
      })
    );
  });
});
