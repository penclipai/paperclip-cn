import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";

test.use({
  locale: "zh-CN",
  viewport: { width: 1440, height: 1080 },
});

type CompanySummary = {
  id: string;
  issuePrefix: string;
  name: string;
};

const SWITCHER_SELECTOR =
  'button[aria-label="切换语言"], button[aria-label="Switch language"]';
const ACCOUNT_MENU_SELECTOR =
  'button[aria-label="打开账号菜单"], button[aria-label="Open account menu"]';

async function createCompany(
  request: APIRequestContext,
  name: string,
): Promise<CompanySummary> {
  const response = await request.post("/api/companies", {
    data: { name },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as CompanySummary;
}

async function openLanguageMenu(container: Page | Locator): Promise<Locator> {
  const switcher = container.locator(SWITCHER_SELECTOR).first();
  await expect(switcher).toBeVisible();
  await switcher.click();
  return switcher;
}

async function openAccountLanguageMenu(page: Page): Promise<Locator> {
  const accountMenu = page.locator(ACCOUNT_MENU_SELECTOR).first();
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();

  const accountDialog = page.getByRole("dialog").first();
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.getByRole("button", { name: "中文" })).toBeVisible();
  const englishOption = accountDialog.getByRole("button", { name: "English" });
  await expect(englishOption).toBeVisible();
  return englishOption;
}

test.describe("Language switcher", () => {
  test("switches language in dashboard and onboarding dialog", async ({
    page,
    request,
  }) => {
    const company = await createCompany(
      request,
      `Language E2E ${Date.now()}`,
    );
    const agentResponse = await request.post(`/api/companies/${company.id}/agents`, {
      data: {
        name: "Language switcher fixture",
        role: "engineer",
        adapterType: "process",
        adapterConfig: { command: process.execPath, args: ["-e", ""] },
        runtimeConfig: { heartbeat: { enabled: false, wakeOnDemand: false } },
      },
    });
    expect(agentResponse.ok()).toBe(true);

    // The CN fork defaults to zh-CN. Keep the dashboard test explicit, while
    // the fixture agent prevents the dashboard's empty-company onboarding offer
    // from covering the account menu we need to exercise.
    await page.addInitScript(() => {
      localStorage.setItem("paperclip.locale", "zh-CN");
    });

    await page.goto(`/${company.issuePrefix}/dashboard`);

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle(/仪表盘/);

    await openAccountLanguageMenu(page);
    await page.getByRole("button", { name: "English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Dashboard/);
    await expect(page.getByRole("button", { name: "New Task" })).toBeVisible();
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Dashboard/);

    await page.goto(`/${company.issuePrefix}/onboarding`);

    const wizardContainer = page.locator("div.fixed.inset-0.z-50.flex").first();
    await expect(wizardContainer).toBeVisible();
    await expect(
      wizardContainer.locator('button[aria-label="Switch language"]'),
    ).toBeVisible();

    const wizardSwitcher = await openLanguageMenu(wizardContainer);
    await page.getByRole("button", { name: "简体中文" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(wizardSwitcher).toHaveAttribute("aria-label", "切换语言");
  });
});
