import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { test, expect, type Browser, type Page } from "@playwright/test";

const BASE = process.env.PAPERCLIP_E2E_BASE_URL ?? "http://127.0.0.1:3105";
const DATA_DIR =
  process.env.PAPERCLIP_E2E_DATA_DIR ?? process.env.PAPERCLIP_HOME;
const CONFIG_PATH =
  process.env.PAPERCLIP_E2E_CONFIG_PATH ??
  path.resolve(process.cwd(), ".paperclip/config.json");
const BOOTSTRAP_SCRIPT_PATH = path.resolve(
  process.cwd(),
  "packages/db/scripts/create-auth-bootstrap-invite.ts",
);
const OWNER_PASSWORD = "paperclip-owner-password";
const INVITED_PASSWORD = "paperclip-invited-password";

type HumanUser = {
  name: string;
  email: string;
  password: string;
};

type CompanySummary = {
  id: string;
  name: string;
  issuePrefix?: string | null;
};

type CompanyMember = {
  id: string;
  membershipRole: "owner" | "admin" | "operator" | "viewer";
  status: "pending" | "active" | "suspended";
  user: { id: string; email: string | null; name: string | null } | null;
};

type SessionJsonResponse<T> = {
  ok: boolean;
  status: number;
  text: string;
  json: T | null;
};

const runId = process.env.PAPERCLIP_E2E_RUN_ID ?? "authenticated-multiuser";
const companyName = `MU-Auth-${runId}`;
const ownerUser: HumanUser = {
  name: "Owner User",
  email: `owner-${runId}@paperclip.local`,
  password: OWNER_PASSWORD,
};
const invitedUser: HumanUser = {
  name: "Invited User",
  email: `invitee-${runId}@paperclip.local`,
  password: INVITED_PASSWORD,
};

function createBootstrapInvite() {
  if (!DATA_DIR) {
    throw new Error(
      "PAPERCLIP_E2E_DATA_DIR or PAPERCLIP_HOME is required for authenticated bootstrap tests",
    );
  }
  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `Authenticated bootstrap config not found at ${CONFIG_PATH}`,
    );
  }
  if (!existsSync(BOOTSTRAP_SCRIPT_PATH)) {
    throw new Error(
      `Authenticated bootstrap helper not found at ${BOOTSTRAP_SCRIPT_PATH}`,
    );
  }

  return execFileSync(
    process.execPath,
    [
      "cli/node_modules/tsx/dist/cli.mjs",
      BOOTSTRAP_SCRIPT_PATH,
      "--config",
      CONFIG_PATH,
      "--base-url",
      BASE,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        PAPERCLIP_HOME: DATA_DIR,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  ).trim();
}

async function signUp(page: Page, user: HumanUser) {
  await page.goto(`${BASE}/auth`);
  await expect(
    page.getByRole("heading", { name: "Sign in to Paperclip" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create one" }).click();
  await expect(
    page.getByRole("heading", { name: "Create your Paperclip account" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create Account" }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function signIn(page: Page, user: HumanUser) {
  await page.goto(`${BASE}/auth`);
  await expect(
    page.getByRole("heading", { name: "Sign in to Paperclip" }),
  ).toBeVisible();
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/auth/, { timeout: 20_000 });
}

async function acceptBootstrapInvite(page: Page, inviteUrl: string) {
  await page.goto(inviteUrl);
  await expect(
    page.getByRole("heading", { name: "Set up Paperclip" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Accept invite" }).click();
  await expect(
    page.getByRole("heading", { name: "Bootstrap complete" }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("link", { name: "Open board" }).click();
}

async function createCompanyForSession(page: Page, nextCompanyName: string) {
  const createRes = await sessionJsonRequest<CompanySummary>(
    page,
    `${BASE}/api/companies`,
    {
      method: "POST",
      data: { name: nextCompanyName },
    },
  );
  expect(createRes.ok).toBe(true);
  expect(createRes.json).toBeTruthy();
  return createRes.json!;
}

async function seedSyntheticProcessAgent(page: Page, companyId: string) {
  const created = await sessionJsonRequest(
    page,
    `${BASE}/api/companies/${companyId}/agents`,
    {
      method: "POST",
      data: {
        name: "E2E fixture agent",
        adapterType: "process",
        adapterConfig: {
          command: process.execPath,
          args: ["-e", "process.exit(0)"],
        },
        runtimeConfig: { heartbeat: { enabled: false } },
      },
    },
  );
  expect(created.ok).toBe(true);
}

async function createAuthenticatedInvite(page: Page, companyPrefix: string) {
  await page.goto(
    `${BASE}/${companyPrefix}/company/settings/members?tab=invites`,
  );
  await expect(
    page.getByRole("heading", { name: "Invite a person" }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("radio", { name: /^Operator Default/ }).check();
  await page.getByRole("button", { name: "Create invite" }).click();
  const inviteField = page.getByLabel("Latest invite URL");
  await expect(inviteField).toBeVisible({ timeout: 20_000 });
  return (await inviteField.inputValue()).trim();
}

async function signUpFromInvite(
  page: Page,
  inviteUrl: string,
  user: HumanUser,
) {
  await page.goto(inviteUrl);
  await expect(
    page.getByRole("heading", { name: "Create your account" }),
  ).toBeVisible();
  await page.getByLabel("Name").fill(user.name);
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page
    .getByRole("button", { name: "Create account and continue" })
    .click();
  await expect(page).toHaveURL(new RegExp(`/invite/[^/]+$`), {
    timeout: 20_000,
  });
}

async function acceptHumanInvite(page: Page) {
  // Current invite registration submits the human join request inline and lands
  // the new member on the company dashboard. Membership activation is asserted
  // immediately afterwards through the owner session.
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: 20_000,
  });
}

async function sessionJsonRequest<T>(
  page: Page,
  url: string,
  options: {
    method?: string;
    data?: unknown;
  } = {},
) {
  return page.evaluate(
    async ({ url: targetUrl, method, data }) => {
      const response = await fetch(targetUrl, {
        method,
        credentials: "include",
        headers:
          data === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      const text = await response.text();
      let json: unknown = null;
      if (text.length > 0) {
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
      }
      return {
        ok: response.ok,
        status: response.status,
        text,
        json,
      };
    },
    {
      url,
      method: options.method ?? "GET",
      data: options.data,
    },
  ) as Promise<SessionJsonResponse<T>>;
}

async function waitForMember(page: Page, companyId: string, email: string) {
  let member: CompanyMember | null = null;
  await expect
    .poll(
      async () => {
        const membersRes = await sessionJsonRequest<{
          members: CompanyMember[];
        }>(page, `${BASE}/api/companies/${companyId}/members`);
        expect(membersRes.ok).toBe(true);
        const body = membersRes.json;
        if (!body) return null;
        member =
          body.members.find((entry) => entry.user?.email === email) ?? null;
        return member;
      },
      {
        timeout: 20_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toMatchObject({
      status: "active",
      membershipRole: "operator",
      user: { email },
    });
  return member!;
}

async function waitForMemberRole(
  page: Page,
  companyId: string,
  memberId: string,
  membershipRole: CompanyMember["membershipRole"],
) {
  await expect
    .poll(
      async () => {
        const membersRes = await sessionJsonRequest<{
          members: CompanyMember[];
        }>(page, `${BASE}/api/companies/${companyId}/members`);
        expect(membersRes.ok).toBe(true);
        const body = membersRes.json;
        if (!body) return null;
        return body.members.find((member) => member.id === memberId) ?? null;
      },
      {
        timeout: 20_000,
        intervals: [500, 1_000, 2_000],
      },
    )
    .toMatchObject({
      id: memberId,
      membershipRole,
    });
}

async function newPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

async function ensureOwnerSession(page: Page) {
  const health = (await (
    await page.request.get(`${BASE}/api/health`)
  ).json()) as { bootstrapStatus?: string };
  if (health.bootstrapStatus === "bootstrap_pending") {
    await signUp(page, ownerUser);
    await acceptBootstrapInvite(page, createBootstrapInvite());
    return;
  }
  await signIn(page, ownerUser);
}

async function createJoinedHuman(
  browser: Browser,
  ownerPage: Page,
  company: CompanySummary,
  user: HumanUser,
) {
  const invite = await sessionJsonRequest<{ inviteUrl: string }>(
    ownerPage,
    `${BASE}/api/companies/${company.id}/invites`,
    {
      method: "POST",
      data: { allowedJoinTypes: "human", humanRole: "operator" },
    },
  );
  expect(invite.ok).toBe(true);
  const invited = await newPage(browser);
  await signUp(invited.page, user);
  const token = new URL(invite.json!.inviteUrl, BASE).pathname
    .split("/")
    .at(-1);
  const accepted = await sessionJsonRequest(
    invited.page,
    `${BASE}/api/invites/${token}/accept`,
    { method: "POST", data: { requestType: "human" } },
  );
  expect(accepted.ok).toBe(true);
  return invited;
}

test.describe("Multi-user: authenticated mode", () => {
  test("authenticated humans can bootstrap, invite, join, and respect viewer restrictions", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000);

    const healthRes = await page.request.get(`${BASE}/api/health`);
    expect(healthRes.ok()).toBe(true);
    const health = (await healthRes.json()) as {
      deploymentMode?: string;
      bootstrapStatus?: string;
    };
    expect(health.deploymentMode).toBe("authenticated");

    await ensureOwnerSession(page);

    const company = await createCompanyForSession(page, companyName);
    const companyPrefix = company.issuePrefix ?? company.id;
    await seedSyntheticProcessAgent(page, company.id);
    await page.goto(`${BASE}/${companyPrefix}/dashboard`);
    const accountMenu = page.getByRole("button", { name: "Open account menu" });
    await expect(accountMenu).toContainText(ownerUser.name);
    await accountMenu.click();
    await expect(page.getByText(ownerUser.email)).toBeVisible();
    const inviteUrl = await createAuthenticatedInvite(page, companyPrefix);

    const invited = await newPage(browser);
    try {
      await signUpFromInvite(invited.page, inviteUrl, invitedUser);
      await acceptHumanInvite(invited.page);
      await expect(invited.page).not.toHaveURL(/\/auth/, { timeout: 10_000 });

      const joinedMember = await waitForMember(
        page,
        company.id,
        invitedUser.email,
      );

      await page.goto(`${BASE}/${companyPrefix}/company/settings/members`);
      const memberRow = page
        .getByRole("row")
        .filter({ hasText: invitedUser.email });
      await expect(memberRow).toBeVisible({ timeout: 20_000 });
      await memberRow
        .getByRole("button", { name: "Edit", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Edit member" }),
      ).toBeVisible();
      await page.getByLabel("Organization role").selectOption("viewer");
      await page.getByRole("button", { name: "Save member" }).click();
      await waitForMemberRole(page, company.id, joinedMember.id, "viewer");

      await invited.page.goto(
        `${BASE}/${companyPrefix}/company/settings/members?tab=invites`,
      );
      await expect(
        invited.page.getByText(
          "You do not have permission to manage organization members.",
        ),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        invited.page.getByRole("button", { name: "Create invite" }),
      ).toHaveCount(0);

      const forbiddenInviteRes = await sessionJsonRequest(
        invited.page,
        `${BASE}/api/companies/${company.id}/invites`,
        {
          method: "POST",
          data: {
            allowedJoinTypes: "human",
            humanRole: "viewer",
          },
        },
      );
      expect(forbiddenInviteRes.status).toBe(403);
    } finally {
      await invited.context.close();
    }
  });
});

test("authenticated owner cannot change their own membership", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await ensureOwnerSession(page);
  const company = await createCompanyForSession(page, `Last owner ${runId}`);
  const invited = await createJoinedHuman(browser, page, company, {
    ...invitedUser,
    email: `last-owner-${invitedUser.email}`,
  });
  try {
    const members = await sessionJsonRequest<{ members: CompanyMember[] }>(
      page,
      `${BASE}/api/companies/${company.id}/members`,
    );
    expect(members.ok).toBe(true);
    const ownerMember = members.json!.members.find(
      (member) => member.user?.email === ownerUser.email,
    );
    expect(ownerMember).toMatchObject({
      membershipRole: "owner",
      status: "active",
    });
    const demote = await sessionJsonRequest(
      page,
      `${BASE}/api/companies/${company.id}/members/${ownerMember!.id}`,
      { method: "PATCH", data: { membershipRole: "operator" } },
    );
    expect(demote.status).toBe(403);
    expect(demote.text).toContain("You cannot remove yourself.");
  } finally {
    await invited.context.close();
  }
});

test("authenticated owner can suspend a different active member", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  await ensureOwnerSession(page);
  const company = await createCompanyForSession(
    page,
    `Suspend member ${runId}`,
  );
  const memberUser = { ...invitedUser, email: `suspend-${invitedUser.email}` };
  const invited = await createJoinedHuman(browser, page, company, memberUser);
  try {
    const member = await waitForMember(page, company.id, memberUser.email);
    const suspended = await sessionJsonRequest<CompanyMember>(
      page,
      `${BASE}/api/companies/${company.id}/members/${member.id}`,
      { method: "PATCH", data: { status: "suspended" } },
    );
    expect(suspended.ok).toBe(true);
    expect(suspended.json).toMatchObject({
      id: member.id,
      status: "suspended",
    });
  } finally {
    await invited.context.close();
  }
});

test("agent chats keep personal identity and ordinary company visibility", async ({
  browser,
  page,
}) => {
  test.setTimeout(120_000);
  const health = (await (
    await page.request.get(`${BASE}/api/health`)
  ).json()) as { deploymentMode?: string; bootstrapStatus?: string };
  expect(health.deploymentMode).toBe("authenticated");
  if (health.bootstrapStatus === "bootstrap_pending") {
    await signUp(page, ownerUser);
    const bootstrapToken = new URL(createBootstrapInvite()).pathname
      .split("/")
      .at(-1);
    expect(
      (
        await sessionJsonRequest(
          page,
          `${BASE}/api/invites/${bootstrapToken}/accept`,
          { method: "POST", data: { requestType: "human" } },
        )
      ).ok,
    ).toBe(true);
  } else {
    await signIn(page, ownerUser);
  }
  const company = await createCompanyForSession(page, `Chat identity ${runId}`);
  const companyPrefix = company.issuePrefix ?? company.id;
  const invite = await sessionJsonRequest<{ inviteUrl: string }>(
    page,
    `${BASE}/api/companies/${company.id}/invites`,
    {
      method: "POST",
      data: { allowedJoinTypes: "human", humanRole: "operator" },
    },
  );
  expect(invite.ok).toBe(true);
  const invited = await newPage(browser);
  try {
    await signUp(invited.page, {
      ...invitedUser,
      email: `chat-${invitedUser.email}`,
    });
    const inviteToken = new URL(invite.json!.inviteUrl, BASE).pathname
      .split("/")
      .at(-1);
    const joined = await sessionJsonRequest(
      invited.page,
      `${BASE}/api/invites/${inviteToken}/accept`,
      { method: "POST", data: { requestType: "human" } },
    );
    expect(joined.ok).toBe(true);
    // Persistent chats are personal identities, not private messaging.
    const originalFlags = await sessionJsonRequest<Record<string, boolean>>(
      page,
      `${BASE}/api/instance/settings/experimental`,
    );
    const enable = await sessionJsonRequest(
      page,
      `${BASE}/api/instance/settings/experimental`,
      { method: "PATCH", data: { enableAgentChat: true } },
    );
    expect(enable.ok).toBe(true);
    try {
      const createdAgent = await sessionJsonRequest<{ id: string }>(
        page,
        `${BASE}/api/companies/${company.id}/agents`,
        {
          method: "POST",
          data: {
            name: "Personal chat identity",
            adapterType: "process",
            adapterConfig: {
              command: process.execPath,
              args: ["-e", "process.exit(0)"],
            },
            runtimeConfig: { heartbeat: { enabled: false } },
          },
        },
      );
      expect(createdAgent.ok).toBe(true);
      const agentId = createdAgent.json!.id;
      const chatEndpoint = `${BASE}/api/companies/${company.id}/chats/${agentId}`;
      await page.goto(`${BASE}/${companyPrefix}/chats/${agentId}`);
      await invited.page.goto(`${BASE}/${companyPrefix}/chats/${agentId}`);
      expect((await sessionJsonRequest(page, chatEndpoint)).json).toBeNull();
      expect(
        (await sessionJsonRequest(invited.page, chatEndpoint)).json,
      ).toBeNull();
      const ownerChat = await sessionJsonRequest<{
        id: string;
        conversationUserId: string;
      }>(page, chatEndpoint, { method: "POST", data: {} });
      const memberChat = await sessionJsonRequest<{
        id: string;
        conversationUserId: string;
      }>(invited.page, chatEndpoint, { method: "POST", data: {} });
      expect(ownerChat.ok).toBe(true);
      expect(memberChat.ok).toBe(true);
      expect(ownerChat.json!.id).not.toBe(memberChat.json!.id);
      expect(ownerChat.json!.conversationUserId).not.toBe(
        memberChat.json!.conversationUserId,
      );
      expect(
        (
          await sessionJsonRequest(
            invited.page,
            `${BASE}/api/issues/${ownerChat.json!.id}`,
          )
        ).ok,
      ).toBe(true);
      expect(
        (
          await sessionJsonRequest(
            page,
            `${BASE}/api/issues/${memberChat.json!.id}`,
          )
        ).ok,
      ).toBe(true);
      await page.reload();
      await invited.page.reload();
      const ownerActions = page.getByRole("button", {
        name: "Open actions for Personal chat identity",
        exact: true,
      });
      await ownerActions.hover({ force: true });
      await ownerActions.click();
      await page
        .getByRole("menuitem", { name: "Star agent", exact: true })
        .click();
      await expect(ownerActions).toBeVisible();
      const invitedActions = invited.page.getByRole("button", {
        name: "Open actions for Personal chat identity",
        exact: true,
      });
      await invitedActions.hover({ force: true });
      await invitedActions.click();
      await expect(
        invited.page.getByRole("menuitem", { name: "Star agent", exact: true }),
      ).toBeVisible();
      await invited.page.keyboard.press("Escape");
      const ownerRecent = await page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("paperclip.recentAgentChats:"),
        ),
      );
      const memberRecent = await invited.page.evaluate(() =>
        Object.keys(localStorage).filter((key) =>
          key.startsWith("paperclip.recentAgentChats:"),
        ),
      );
      expect(
        ownerRecent.some((key) =>
          key.endsWith(ownerChat.json!.conversationUserId),
        ),
      ).toBe(true);
      expect(
        memberRecent.some((key) =>
          key.endsWith(memberChat.json!.conversationUserId),
        ),
      ).toBe(true);
      const another = await createCompanyForSession(
        page,
        `Private company ${runId}`,
      );
      const forbidden = await sessionJsonRequest(
        invited.page,
        `${BASE}/api/companies/${another.id}/chats/${agentId}`,
      );
      expect([403, 404]).toContain(forbidden.status);
    } finally {
      const restore = await sessionJsonRequest(
        page,
        `${BASE}/api/instance/settings/experimental`,
        {
          method: "PATCH",
          data: { enableAgentChat: originalFlags.json!.enableAgentChat },
        },
      );
      expect(restore.ok).toBe(true);
    }
  } finally {
    await invited.context.close();
  }
});

test("task toasts follow personal involvement in multiplayer", async ({ browser, page }, testInfo) => {
  test.setTimeout(180_000);
  page.setDefaultTimeout(15_000);
  // Observe the real socket handshake so mutations after navigation do not
  // race subscription setup. No network responses or event payloads are mocked.
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    const sockets: WebSocket[] = [];
    (window as unknown as { toastTestSockets: WebSocket[] }).toastTestSockets = sockets;
    window.WebSocket = class extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  await signUp(page, { ...ownerUser, email: `toasts-${ownerUser.email}` });
  const bootstrapToken = new URL(createBootstrapInvite()).pathname.split("/").at(-1);
  expect((await sessionJsonRequest(page, `${BASE}/api/invites/${bootstrapToken}/accept`, {
    method: "POST", data: { requestType: "human" },
  })).ok).toBe(true);
  const company = await createCompanyForSession(page, `Personal notifications ${runId}`);
  const prefix = company.issuePrefix ?? company.id;
  const invite = await sessionJsonRequest<{ inviteUrl: string }>(page, `${BASE}/api/companies/${company.id}/invites`, {
    method: "POST", data: { allowedJoinTypes: "human", humanRole: "operator" },
  });
  expect(invite.ok).toBe(true);
  const other = await newPage(browser);
  try {
    await signUp(other.page, { ...invitedUser, email: `toasts-${invitedUser.email}` });
    const token = new URL(invite.json!.inviteUrl, BASE).pathname.split("/").at(-1);
    expect((await sessionJsonRequest(other.page, `${BASE}/api/invites/${token}/accept`, {
      method: "POST", data: { requestType: "human" },
    })).ok).toBe(true);
    const session = await sessionJsonRequest<{ user: { id: string } }>(page, `${BASE}/api/auth/get-session`);
    const viewerId = session.json!.user.id;
    const task = await sessionJsonRequest<{ id: string; identifier: string }>(other.page, `${BASE}/api/companies/${company.id}/issues`, {
      method: "POST", data: { title: "Another person's task", status: "backlog" },
    });
    expect(task.ok).toBe(true);
    const id = task.json!.id;
    const frames: Array<{ toastEligible?: boolean; payload: { entityId?: string; action?: string } }> = [];
    page.on("websocket", socket => socket.on("framereceived", frame => {
      try { frames.push(JSON.parse(String(frame.payload))); } catch { /* ignore control frames */ }
    }));
    await page.goto(`${BASE}/${prefix}/issues?view=all`);
    await expect(page.getByText("Another person's task", { exact: true }).first()).toBeVisible();
    await other.page.goto(`${BASE}/${prefix}/issues?view=all`);
    const toasts = page.locator('aside[aria-live="polite"]');
    async function waitForSocket() {
      await page.waitForFunction((companyId) =>
        (window as unknown as { toastTestSockets: WebSocket[] }).toastTestSockets.some(socket =>
          socket.url.includes(`/companies/${companyId}/events/ws`) && socket.readyState === WebSocket.OPEN), company.id);
    }
    async function update(title: string, eligible: boolean) {
      await waitForSocket();
      // Let the existing two-second server list cache expire after navigation.
      // This case tests steady-state notification scoping, not cache TTL policy.
      await page.waitForTimeout(2200);
      const before = frames.length;
      expect((await sessionJsonRequest(other.page, `${BASE}/api/issues/${id}`, {
        method: "PATCH", data: { title },
      })).ok).toBe(true);
      await expect.poll(() => frames.slice(before).find(e => e.payload.entityId === id && e.payload.action === "issue.updated")?.toastEligible)
        .toBe(eligible);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
      if (eligible) {
        await expect(toasts).toContainText("Invited User updated");
        await testInfo.attach(title, { body: await page.screenshot(), contentType: "image/png" });
        await page.getByRole("button", { name: "Dismiss notification" }).click();
      } else {
        await expect(toasts).toHaveCount(0);
      }
      // Each qualifying update is a distinct observation, outside deduplication.
      await page.waitForTimeout(3600);
    }
    await update("Unrelated update still refreshes the list", false);
    // Visiting alone must not subscribe the user.
    await page.getByRole("link", { name: `Open ${task.json!.identifier}: Unrelated update still refreshes the list`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/issues/(${id}|${task.json!.identifier})`));
    await page.goto(`${BASE}/${prefix}/issues?view=all`);
    await update("Viewing is still quiet", false);
    // Use persisted API fixtures to vary participation, observing actual live UI.
    expect((await sessionJsonRequest(other.page, `${BASE}/api/issues/${id}/comments`, {
      method: "POST", data: { body: `Please review [Owner](user://${viewerId}).` },
    })).ok).toBe(true);
    await expect(toasts).toContainText("Invited User commented on");
    await testInfo.attach("First mention notifies", { body: await page.screenshot(), contentType: "image/png" });
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.reload();
    await expect(page.getByText("Viewing is still quiet", { exact: true }).first()).toBeVisible();
    await update("Historical mention survives reload", true);
    // Same event must not toast to its author in the second authenticated session.
    await expect(other.page.locator('aside[aria-live="polite"]')).toHaveCount(0);
    // Viewing the qualifying task suppresses redundant notifications.
    await page.getByRole("link", { name: `Open ${task.json!.identifier}: Historical mention survives reload`, exact: true }).click();
    await expect(page.getByRole("heading", { name: "Historical mention survives reload", exact: true })).toBeVisible();
    await waitForSocket();
    const beforeComment = frames.length;
    expect((await sessionJsonRequest(other.page, `${BASE}/api/issues/${id}/comments`, {
      method: "POST", data: { body: "Already visible in the task." },
    })).ok).toBe(true);
    await expect.poll(() => frames.slice(beforeComment).find(e => e.payload.entityId === id && e.payload.action === "issue.comment_added")?.toastEligible)
      .toBe(true);
    await expect(page.getByText("Already visible in the task.", { exact: true }).first()).toBeVisible();
    await expect(toasts).toHaveCount(0);
  } finally { await other.context.close(); }
});
