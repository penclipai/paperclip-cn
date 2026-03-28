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

test.describe("Language switcher", () => {
  test("switches language in dashboard and onboarding dialog", async ({
    page,
    request,
  }) => {
    const company = await createCompany(
      request,
      `Language E2E ${Date.now()}`,
    );

    await page.goto(`/${company.issuePrefix}/dashboard`);

    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page).toHaveTitle(/仪表盘/);

    await openLanguageMenu(page);
    await page.getByRole("button", { name: "English" }).click();

    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page).toHaveTitle(/Dashboard/);
    await expect(page.getByText("Documentation")).toBeVisible();
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
