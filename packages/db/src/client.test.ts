import { createHash } from "node:crypto";
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import {
  DEFAULT_DATABASE_APPLICATION_NAME,
  applyPendingMigrations,
  createDb,
  inspectMigrations,
  resetPostgresDatabase,
} from "./client.js";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./test-embedded-postgres.js";

const cleanups: Array<() => Promise<void>> = [];
const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;
const MIGRATION_TEST_TIMEOUT = process.platform === "win32" ? 60_000 : 20_000;
const MIGRATION_CLEANUP_TIMEOUT = process.platform === "win32" ? 90_000 : 30_000;

async function createTempDatabase(): Promise<string> {
  const db = await startEmbeddedPostgresTestDatabase("paperclip-db-client-");
  cleanups.push(db.cleanup);
  return db.connectionString;
}

async function migrationHash(migrationFile: string): Promise<string> {
  const content = await fs.promises.readFile(
    new URL(`./migrations/${migrationFile}`, import.meta.url),
    "utf8",
  );
  return createHash("sha256").update(content).digest("hex");
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

const userVisibleUpdatedAtTables = new Set([
  "companies",
  "heartbeat_runs",
  "issue_comments",
  "issues",
  "routine_runs",
  "routines",
]);

const migrationUpdatedAtUpdateAllowlist = new Map<string, ReadonlySet<string>>([
  [
    "0105_instance_scoped_environments.sql",
    new Set(["issues"]),
  ],
  [
    "0131_repair_run_responsible_user_context_refs.sql",
    new Set(["heartbeat_runs"]),
  ],
  [
    "0135_repair_run_responsible_user_updated_at_sweep.sql",
    new Set(["companies", "heartbeat_runs", "issues", "routine_runs", "routines"]),
  ],
]);

function findUserVisibleUpdatedAtBackfillViolations(
  migrationFile: string,
  content: string,
): string[] {
  const allowedTables = migrationUpdatedAtUpdateAllowlist.get(migrationFile) ?? new Set<string>();
  const violations: string[] = [];

  for (const statement of content.split("--> statement-breakpoint")) {
    const updateMatch = statement.match(/\bUPDATE\s+"([^"]+)"/i);
    if (!updateMatch) continue;

    const tableName = updateMatch[1];
    if (!userVisibleUpdatedAtTables.has(tableName)) continue;
    if (!/\bSET\b[\s\S]*"updated_at"\s*=/i.test(statement)) continue;
    if (allowedTables.has(tableName)) continue;

    violations.push(`${migrationFile}: UPDATE "${tableName}" sets updated_at`);
  }

  return violations;
}

afterEach(async () => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    await cleanup?.();
  }
}, MIGRATION_CLEANUP_TIMEOUT);

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres migration tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("createDb pool defaults", () => {
  it("names its backends and closes them once idle", async () => {
    const url = await createTempDatabase();
    const observer = postgres(url, { max: 1, onnotice: () => {} });
    cleanups.push(async () => {
      await observer.end({ timeout: 1 });
    });

    const backendsNamed = async (name: string) => {
      const rows = await observer`
        select count(*)::int as count from pg_stat_activity where application_name = ${name}
      `;
      return rows[0]?.count ?? 0;
    };

    const db = createDb(url);
    cleanups.push(async () => {
      await db.$client.end({ timeout: 1 });
    });
    const [self] = await db.$client`select application_name from pg_stat_activity where pid = pg_backend_pid()`;
    expect(self?.application_name).toBe(DEFAULT_DATABASE_APPLICATION_NAME);

    const shortLived = createDb(url, { applicationName: "paperclip-idle-test", idleTimeoutSeconds: 1 });
    cleanups.push(async () => {
      await shortLived.$client.end({ timeout: 1 });
    });
    await shortLived.$client`select 1`;
    expect(await backendsNamed("paperclip-idle-test")).toBe(1);

    // The driver closes the idle connection after `idle_timeout`; without the
    // option (the driver default) the backend would stay until the process
    // exits. Wait past the timeout, then poll PostgreSQL's own view.
    const deadline = Date.now() + 10_000;
    let remaining = await backendsNamed("paperclip-idle-test");
    while (remaining > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      remaining = await backendsNamed("paperclip-idle-test");
    }
    expect(remaining).toBe(0);
  }, 30_000);

  it("reconciles guarded foreign keys by target relation and exact definition", async () => {
    const connectionString = await createTempDatabase();
    await applyPendingMigrations(connectionString);
    const hash = await migrationHash("0249_fast_silverclaw.sql");
    const constraint = "tool_action_deliveries_action_request_id_tool_action_requests_id_fk";
    const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await sql.unsafe(`CREATE TABLE "migration_fk_collision" ("id" uuid PRIMARY KEY, "company_id" uuid NOT NULL)`);
      await sql.unsafe(`ALTER TABLE "migration_fk_collision" ADD CONSTRAINT "${constraint}" FOREIGN KEY ("company_id") REFERENCES "companies"("id")`);
      await sql.unsafe(`ALTER TABLE "tool_action_deliveries" DROP CONSTRAINT "${constraint}"`);
      await sql`DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`;
    } finally { await sql.end(); }

    await expect(applyPendingMigrations(connectionString)).resolves.toBeUndefined();
    const verify = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      const restored = await verify<{ count: string }[]>`
        SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.tool_action_deliveries'::regclass AND conname = ${constraint}
      `;
      expect(Number(restored[0]!.count)).toBe(1);
      await verify.unsafe(`ALTER TABLE "tool_action_deliveries" DROP CONSTRAINT "${constraint}"`);
      await verify.unsafe(`ALTER TABLE "tool_action_deliveries" ADD CONSTRAINT "${constraint}" FOREIGN KEY ("action_request_id") REFERENCES "companies"("id")`);
      await verify`DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`;
    } finally { await verify.end(); }
    await expect(applyPendingMigrations(connectionString)).rejects.toThrow("Refusing to replay migration 0249_fast_silverclaw.sql");
    const rejected = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      expect(await rejected`SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`).toHaveLength(0);
      await rejected.unsafe(`ALTER TABLE "tool_action_deliveries" DROP CONSTRAINT "${constraint}"`);
      await rejected.unsafe(`ALTER TABLE "tool_action_deliveries" ADD CONSTRAINT "${constraint}" CHECK ("action_request_id" IS NOT NULL)`);
    } finally { await rejected.end(); }
    await expect(applyPendingMigrations(connectionString)).rejects.toThrow("Refusing to replay migration 0249_fast_silverclaw.sql");
    const wrongType = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      expect(await wrongType`SELECT id FROM "drizzle"."__drizzle_migrations" WHERE hash = ${hash}`).toHaveLength(0);
    } finally { await wrongType.end(); }
  }, 30_000);
});

describeEmbeddedPostgres("resetPostgresDatabase", () => {
  it("recreates an existing database so stale tables are removed", async () => {
    const connectionString = await createTempDatabase();
    const adminUrl = new URL(connectionString);
    const databaseName = adminUrl.pathname.replace(/^\//, "");
    adminUrl.pathname = "/postgres";

    const setupSql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      await setupSql.unsafe(`CREATE TABLE stale_reseed_target_only (id integer PRIMARY KEY)`);
    } finally {
      await setupSql.end();
    }

    await resetPostgresDatabase(adminUrl.toString(), databaseName);

    const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
    try {
      const rows = await verifySql.unsafe<{ stale_table: string | null }[]>(
        `SELECT to_regclass('public.stale_reseed_target_only')::text AS stale_table`,
      );
      expect(rows[0]?.stale_table).toBeNull();
    } finally {
      await verifySql.end();
    }
  }, 30_000);
});

describeEmbeddedPostgres("applyPendingMigrations", () => {
  it("rejects unallowlisted migration backfills that bump updated_at on user-visible tables", async () => {
    const entries = await fs.promises.readdir(new URL("./migrations", import.meta.url), {
      withFileTypes: true,
    });
    const violations: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
      const content = await fs.promises.readFile(
        new URL(`./migrations/${entry.name}`, import.meta.url),
        "utf8",
      );
      violations.push(...findUserVisibleUpdatedAtBackfillViolations(entry.name, content));
    }

    expect(violations).toEqual([]);
    expect(
      findUserVisibleUpdatedAtBackfillViolations(
        "9999_bad_backfill.sql",
        `
          UPDATE "issues" AS i
          SET "responsible_user_id" = 'owner-user',
              "updated_at" = now()
          WHERE i."responsible_user_id" IS NULL;
        `,
      ),
    ).toEqual(['9999_bad_backfill.sql: UPDATE "issues" sets updated_at']);
  });

  it(
    "treats LF and CRLF migration content as the same migration identity",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const migrationFile = "0001_fast_northstar.sql";
      const content = await fs.promises.readFile(
        new URL(`./migrations/${migrationFile}`, import.meta.url),
        "utf8",
      );
      const currentHash = contentHash(content);
      const normalizedLf = content.replace(/\r\n?/g, "\n");
      const lfHash = contentHash(normalizedLf);
      const crlfHash = contentHash(normalizedLf.replaceAll("\n", "\r\n"));
      const alternateHash = currentHash === lfHash ? crlfHash : lfHash;
      expect(alternateHash).not.toBe(currentHash);

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const updated = await sql<{ id: number }[]>`
          UPDATE "drizzle"."__drizzle_migrations"
          SET "hash" = ${alternateHash}
          WHERE "hash" = ${currentHash}
          RETURNING "id"
        `;
        expect(updated).toHaveLength(1);
      } finally {
        await sql.end();
      }

      expect(await inspectMigrations(connectionString)).toMatchObject({ status: "upToDate" });
      await expect(applyPendingMigrations(connectionString)).resolves.toBeUndefined();
    },
    MIGRATION_TEST_TIMEOUT,
  );

  it(
    "refuses to replay a partially applied historical migration with incompatible history",
    async () => {
      const connectionString = await createTempDatabase();
      await applyPendingMigrations(connectionString);

      const migrationFile = "0001_fast_northstar.sql";
      const currentHash = await migrationHash(migrationFile);
      const incompatibleHash = "f".repeat(64);
      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const updated = await sql<{ id: number }[]>`
          UPDATE "drizzle"."__drizzle_migrations"
          SET "hash" = ${incompatibleHash}
          WHERE "hash" = ${currentHash}
          RETURNING "id"
        `;
        expect(updated).toHaveLength(1);
      } finally {
        await sql.end();
      }

      expect(await inspectMigrations(connectionString)).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: [migrationFile],
      });
      await expect(applyPendingMigrations(connectionString)).rejects.toThrow(
        `Refusing to replay migration ${migrationFile}`,
      );

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql<{ relation: string | null }[]>`
          SELECT to_regclass('public.agent_runtime_state')::text AS relation
        `;
        expect(rows[0]?.relation).toBe("agent_runtime_state");
      } finally {
        await verifySql.end();
      }
    },
    MIGRATION_TEST_TIMEOUT,
  );

  it(
    "applies an inserted earlier migration without replaying later legacy migrations",
    async () => {
      const connectionString = await createTempDatabase();

      const sql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const richMagnetoHash = await migrationHash("0030_rich_magneto.sql");

        await sql.unsafe(
          `DELETE FROM "drizzle"."__drizzle_migrations" WHERE hash = '${richMagnetoHash}'`,
        );
        await sql.unsafe(`DROP TABLE "company_logos"`);
      } finally {
        await sql.end();
      }

      const pendingState = await inspectMigrations(connectionString);
      expect(pendingState).toMatchObject({
        status: "needsMigrations",
        pendingMigrations: ["0030_rich_magneto.sql"],
        reason: "pending-migrations",
      });

      await applyPendingMigrations(connectionString);

      const finalState = await inspectMigrations(connectionString);
      expect(finalState.status).toBe("upToDate");

      const verifySql = postgres(connectionString, { max: 1, onnotice: () => {} });
      try {
        const rows = await verifySql.unsafe<{ table_name: string }[]>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN ('company_logos', 'execution_workspaces')
            ORDER BY table_name
          `,
        );
        expect(rows.map((row) => row.table_name)).toEqual([
          "company_logos",
          "execution_workspaces",
        ]);
      } finally {
        await verifySql.end();
      }
    },
    MIGRATION_TEST_TIMEOUT,
  );
});
