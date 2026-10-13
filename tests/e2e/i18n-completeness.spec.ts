import { expect, test, type APIRequestContext } from "@playwright/test";

type Seed = { companyId: string; prefix: string; issueId: string };

async function seedRepresentativeBoard(request: APIRequestContext): Promise<Seed> {
  const companyResponse = await request.post("/api/companies", {
    data: { name: `i18n completeness ${Date.now()}` },
  });
  expect(companyResponse.ok(), await companyResponse.text()).toBe(true);
  const company = await companyResponse.json();
  const companyId = company.id as string;
  const prefix = (company.issuePrefix ?? company.prefix ?? company.urlKey) as string;

  const projectResponse = await request.post(`/api/companies/${companyId}/projects`, {
    data: { name: "User Project Name" },
  });
  expect(projectResponse.ok(), await projectResponse.text()).toBe(true);
  const project = await projectResponse.json();
  const issueResponse = await request.post(`/api/companies/${companyId}/issues`, {
    data: { title: "User-authored English issue", status: "todo", projectId: project.id },
  });
  expect(issueResponse.ok(), await issueResponse.text()).toBe(true);
  const issue = await issueResponse.json();
  return { companyId, prefix, issueId: issue.id as string };
}

test.describe.serial("localized production board smoke coverage", () => {
  let seed: Seed;

  test.beforeAll(async ({ request }) => {
    seed = await seedRepresentativeBoard(request);
  });

  test("zh-CN chrome is localized while user-authored text stays verbatim", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("paperclip.locale", "zh-CN"));
    await page.goto(`/${seed.prefix}/dashboard`);
    await expect(page.getByText("仪表盘", { exact: true }).first()).toBeVisible({ timeout: 20_000 });

    await page.goto(`/${seed.prefix}/issues/${seed.issueId}`);
    await expect(page.getByRole("heading", { name: "User-authored English issue", exact: true })).toBeVisible({ timeout: 20_000 });
  });

  test("language switch preserves an unsaved search draft", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("paperclip.locale", "en"));
    await page.goto(`/${seed.prefix}/search`);
    const query = page.getByRole("textbox", { name: /Search query|搜索查询/ });
    await expect(query).toBeVisible({ timeout: 20_000 });
    await query.fill("draft stays here");

    await page
      .getByRole("button", { name: /Open account menu|打开账户菜单/ })
      .first()
      .click();
    await page.getByRole("button", { name: "中文", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "搜索内容", exact: true })).toHaveValue("draft stays here");
    await expect(page.getByRole("heading", { name: "搜索", exact: true }).first()).toBeVisible();
  });
});
