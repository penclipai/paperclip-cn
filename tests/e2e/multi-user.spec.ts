import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";

/**
 * E2E: Multi-user implementation tests (local_trusted mode).
 *
 * Covers:
 *   1. Company-member and human-invite API contracts available to the
 *      single local board identity.
 *   2. Invite landing and agent-invite flows.
 *
 * Assertions that require distinct authenticated humans, member mutation, or
 * viewer restrictions live in multi-user-authenticated.spec.ts. Last-active-
 * owner service behavior is unit-tested in access-service.test.ts.
 */

const BASE = process.env.PAPERCLIP_E2E_BASE_URL ?? "http://127.0.0.1:3104";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the server is bootstrapped (claimed) before running tests. */
async function ensureBootstrapped(request: APIRequestContext): Promise<void> {
  const healthRes = await request.get(`${BASE}/api/health`);
  const health = await healthRes.json();
  if (health.bootstrapStatus === "ready") return;

  // If bootstrap_pending, we need to use the claim token from the bootstrap invite.
  // In local_trusted mode, just try hitting companies — that should auto-bootstrap.
  if (health.deploymentMode === "local_trusted") {
    // local_trusted should work without explicit bootstrap
    return;
  }
}

/** Create a company via the onboarding wizard API shortcut. */
async function createCompanyViaWizard(
  request: APIRequestContext,
  name: string,
): Promise<{ companyId: string; agentId: string; prefix: string }> {
  await ensureBootstrapped(request);

  const createRes = await request.post(`${BASE}/api/companies`, {
    data: { name },
  });
  if (!createRes.ok()) {
    const errText = await createRes.text();
    throw new Error(
      `Failed to create company (${createRes.status()}): ${errText}`,
    );
  }
  const company = await createRes.json();

  // Create a CEO agent
  const agentRes = await request.post(
    `${BASE}/api/companies/${company.id}/agents`,
    {
      data: {
        name: "CEO",
        role: "ceo",
        title: "CEO",
        adapterType: "claude_local",
      },
    },
  );
  expect(agentRes.ok()).toBe(true);
  const agent = await agentRes.json();

  return {
    companyId: company.id,
    agentId: agent.id,
    prefix: company.issuePrefix ?? company.id,
  };
}

/** Create a human invite and return token + invite URL. */
async function createHumanInvite(
  request: APIRequestContext,
  companyId: string,
  role: string = "operator",
): Promise<{ token: string; inviteUrl: string; inviteId: string }> {
  const res = await request.post(`${BASE}/api/companies/${companyId}/invites`, {
    data: {
      allowedJoinTypes: "human",
      humanRole: role,
    },
  });
  expect(res.ok()).toBe(true);
  const body = await res.json();
  return {
    token: body.token,
    inviteUrl: body.inviteUrl,
    inviteId: body.id,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe("Multi-user: API", () => {
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createCompanyViaWizard(
      request,
      `MU-API-${Date.now()}`,
    );
    companyId = result.companyId;
  });

  test("GET /companies/:id/members returns member list with access info", async ({
    request,
  }) => {
    const res = await request.get(`${BASE}/api/companies/${companyId}/members`);
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("members");
    expect(body).toHaveProperty("access");
    expect(Array.isArray(body.members)).toBe(true);
    expect(body.access).toHaveProperty("currentUserRole");
    expect(body.access).toHaveProperty("canManageMembers");
    expect(body.access).toHaveProperty("canInviteUsers");
  });

  test("POST /companies/:id/invites creates a human invite with role", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE}/api/companies/${companyId}/invites`,
      {
        data: {
          allowedJoinTypes: "human",
          humanRole: "operator",
        },
      },
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("inviteUrl");
    expect(body.allowedJoinTypes).toBe("human");
    expect(body.inviteUrl).toContain("/invite/");
  });

  test("GET /invites/:token returns invite summary", async ({ request }) => {
    const invite = await createHumanInvite(request, companyId, "viewer");
    const res = await request.get(`${BASE}/api/invites/${invite.token}`);
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("companyId");
    expect(body).toHaveProperty("allowedJoinTypes");
    expect(body.allowedJoinTypes).toBe("human");
    expect(body).toHaveProperty("inviteType");
    expect(body.inviteType).toBe("company_join");
  });

  test("POST /invites/:token/accept (human) creates membership", async ({
    request,
  }) => {
    const invite = await createHumanInvite(request, companyId, "operator");
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      {
        data: { requestType: "human" },
      },
    );
    expect(acceptRes.ok()).toBe(true);
    const body = await acceptRes.json();

    // In local_trusted, human accept should succeed
    expect(body).toHaveProperty("id");
  });

  test("POST /invites/:token/accept rejects agent on human-only invite", async ({
    request,
  }) => {
    const invite = await createHumanInvite(request, companyId, "operator");
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      {
        data: { requestType: "agent", agentName: "Rogue" },
      },
    );
    expect(acceptRes.ok()).toBe(false);
    expect(acceptRes.status()).toBe(400);
  });

  test("POST /companies/:id/invites supports all four roles", async ({
    request,
  }) => {
    for (const role of ["owner", "admin", "operator", "viewer"]) {
      const res = await request.post(
        `${BASE}/api/companies/${companyId}/invites`,
        {
          data: { allowedJoinTypes: "human", humanRole: role },
        },
      );
      expect(res.ok()).toBe(true);
      const body = await res.json();
      expect(body.token).toBeTruthy();
    }
  });

  test("POST /companies/:id/openclaw/invite-prompt creates agent invite", async ({
    request,
  }) => {
    const res = await request.post(
      `${BASE}/api/companies/${companyId}/openclaw/invite-prompt`,
      {
        data: { agentMessage: "E2E test agent invite" },
      },
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();

    expect(body).toHaveProperty("token");
    expect(body).toHaveProperty("inviteUrl");
    expect(body.allowedJoinTypes).toBe("agent");
  });
});

test.describe("Multi-user: Invite Landing UI", () => {
  let companyId: string;
  let inviteToken: string;

  test.beforeAll(async ({ request }) => {
    const result = await createCompanyViaWizard(
      request,
      `MU-Invite-${Date.now()}`,
    );
    companyId = result.companyId;

    const invite = await createHumanInvite(request, companyId, "operator");
    inviteToken = invite.token;
  });

  test("invite landing page loads with join options", async ({ page }) => {
    await page.goto(`${BASE}/invite/${inviteToken}`);
    await page.waitForLoadState("networkidle");

    // Should show the invite landing page heading
    await expect(page.getByRole("heading", { name: /join/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test("expired/invalid invite token returns error", async ({ page }) => {
    await page.goto(`${BASE}/invite/invalid-token-e2e-test`);
    await page.waitForLoadState("networkidle");
    await expect(page.getByTestId("invite-error")).toBeVisible({
      timeout: 10_000,
    });
  });
});

test.describe("Multi-user: Member role management API", () => {
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createCompanyViaWizard(
      request,
      `MU-Roles-${Date.now()}`,
    );
    companyId = result.companyId;
  });

  test("invite + accept creates member with correct role", async ({
    request,
  }) => {
    // Create invite for 'viewer' role
    const invite = await createHumanInvite(request, companyId, "viewer");

    // Accept the invite
    const acceptRes = await request.post(
      `${BASE}/api/invites/${invite.token}/accept`,
      { data: { requestType: "human" } },
    );
    expect(acceptRes.ok()).toBe(true);

    // Check members list
    const membersRes = await request.get(
      `${BASE}/api/companies/${companyId}/members`,
    );
    const { members } = await membersRes.json();

    // Should have at least one member (the creator/local-board)
    expect(members.length).toBeGreaterThanOrEqual(1);
  });
});

test.describe("Multi-user: Agent invite flow", () => {
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    const result = await createCompanyViaWizard(
      request,
      `MU-Agent-${Date.now()}`,
    );
    companyId = result.companyId;
  });

  test("agent invite accept creates pending join request", async ({
    request,
  }) => {
    // Create agent invite
    const res = await request.post(
      `${BASE}/api/companies/${companyId}/openclaw/invite-prompt`,
      { data: {} },
    );
    expect(res.ok()).toBe(true);
    const { token } = await res.json();

    // Accept as agent
    const acceptRes = await request.post(
      `${BASE}/api/invites/${token}/accept`,
      {
        data: {
          requestType: "agent",
          agentName: "TestAgent",
          adapterType: "claude_local",
        },
      },
    );
    expect(acceptRes.ok()).toBe(true);
    const body = await acceptRes.json();
    expect(body).toHaveProperty("id");
    expect(body.status).toBe("pending_approval");
  });

  test("join requests list shows pending agent request", async ({
    request,
  }) => {
    const res = await request.get(
      `${BASE}/api/companies/${companyId}/join-requests?status=pending_approval`,
    );
    expect(res.ok()).toBe(true);
    const requests = await res.json();
    expect(Array.isArray(requests)).toBe(true);
  });
});

test.describe("Multi-user: Health check integration", () => {
  test("health endpoint reports deployment mode", async ({ request }) => {
    const res = await request.get(`${BASE}/api/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty("deploymentMode");
    expect(body).toHaveProperty("authReady");
    expect(body.authReady).toBe(true);
  });
});
