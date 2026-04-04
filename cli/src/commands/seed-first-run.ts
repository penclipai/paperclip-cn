import { randomUUID } from "node:crypto";
import { createDb, companies, agents, goals, issues } from "@penclipai/db";

type SeedFirstRunOptions = {
  apiUrl: string;
  databaseUrl: string;
  companyName?: string;
};

type SeedResult =
  | {
      status: "success";
      companyId: string;
      companyName: string;
      issuePrefix: string;
      agentId: string;
      agentName: string;
      adapterType: string;
      issueId: string;
      issueTitle: string;
    }
  | { status: "skipped"; reason: string };

/**
 * Detect the best available adapter based on environment variables.
 * Priority order: claude_local > codex_local > qwen_local > gemini_local > process
 */
function detectBestAdapter(): { type: string; config: Record<string, unknown> } {
  if (process.env.ANTHROPIC_API_KEY) {
    return {
      type: "claude_local",
      config: {
        model: "claude-sonnet-4-5-20250929",
        apiKeyEnvVar: "ANTHROPIC_API_KEY",
      },
    };
  }
  if (process.env.OPENAI_API_KEY) {
    return {
      type: "codex_local",
      config: {
        model: "gpt-4o",
        apiKeyEnvVar: "OPENAI_API_KEY",
      },
    };
  }
  if (process.env.DASHSCOPE_API_KEY) {
    return {
      type: "qwen_local",
      config: {
        model: "qwen-max",
        apiKeyEnvVar: "DASHSCOPE_API_KEY",
      },
    };
  }
  if (process.env.GEMINI_API_KEY) {
    return {
      type: "gemini_local",
      config: {
        model: "gemini-2.0-flash",
        apiKeyEnvVar: "GEMINI_API_KEY",
      },
    };
  }
  // Fallback: process adapter (no API key needed, runs local commands)
  return {
    type: "process",
    config: {},
  };
}

/**
 * Generate a unique issue prefix for the company.
 * Uses first 4 uppercase letters of company name + random digit.
 */
function generateIssuePrefix(name: string): string {
  const letters = name
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase()
    .slice(0, 4)
    .padEnd(4, "X");
  const digit = Math.floor(Math.random() * 10);
  return `${letters}${digit}`;
}

/**
 * Check if the database already has companies. If yes, skip seeding.
 */
async function hasExistingData(db: ReturnType<typeof createDb>): Promise<boolean> {
  const result = await db.select({ count: companies.id }).from(companies).limit(1);
  return result.length > 0;
}

/**
 * Seed company, CEO agent, and first task on first run.
 * Only seeds if no companies exist yet (safe idempotent operation).
 */
export async function seedFirstRun(opts: SeedFirstRunOptions): Promise<SeedResult> {
  const db = createDb(opts.databaseUrl);

  // Check if we should seed (only if no companies exist)
  const hasData = await hasExistingData(db);
  if (hasData) {
    return { status: "skipped", reason: "Company already exists" };
  }

  const companyName = opts.companyName || "My AI Company";
  const issuePrefix = generateIssuePrefix(companyName);

  // Create company
  const [company] = await db
    .insert(companies)
    .values({
      name: companyName,
      description: `Autonomous AI company created via onboarding`,
      status: "active",
      issuePrefix,
    })
    .returning();

  // Create root company goal
  const [goal] = await db
    .insert(goals)
    .values({
      id: randomUUID(),
      companyId: company.id,
      title: `Build and grow ${companyName}`,
      description: "Primary company mission and strategic objectives",
      level: "company",
      status: "active",
    })
    .returning();

  // Detect best available adapter
  const adapter = detectBestAdapter();

  // Create CEO agent
  const [agent] = await db
    .insert(agents)
    .values({
      companyId: company.id,
      name: "CEO",
      role: "ceo",
      title: "Chief Executive Officer",
      status: "idle",
      adapterType: adapter.type as any,
      adapterConfig: adapter.config as any,
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
    })
    .returning();

  // Create first strategic task
  const [issue] = await db
    .insert(issues)
    .values({
      id: randomUUID(),
      companyId: company.id,
      goalId: goal.id,
      title: "Define company mission and initial strategy",
      description: `You are the CEO of ${companyName}. Your first task is to:

1. Define the company's core mission and vision
2. Identify the top 3 strategic objectives for the next 90 days
3. Create a plan for building out the initial team and capabilities

Think strategically about what kind of AI agents would be most valuable to hire first.
Consider: engineering, research, operations, customer success, and growth roles.

This is your first act as CEO. Make it count.`,
      status: "todo",
      priority: "high",
      assigneeAgentId: agent.id,
    })
    .returning();

  return {
    status: "success",
    companyId: company.id,
    companyName: company.name,
    issuePrefix,
    agentId: agent.id,
    agentName: agent.name,
    adapterType: adapter.type,
    issueId: issue.id,
    issueTitle: issue.title,
  };
}
