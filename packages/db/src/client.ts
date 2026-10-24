import { createHash } from "node:crypto";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { installDatabaseWorkSignals } from "./work-signals.js";
import * as schema from "./schema/index.js";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("./migrations", import.meta.url));
const DRIZZLE_MIGRATIONS_TABLE = "__drizzle_migrations";
const MIGRATIONS_JOURNAL_JSON = fileURLToPath(new URL("./migrations/meta/_journal.json", import.meta.url));

function createUtilitySql(url: string) {
  return postgres(url, { max: 1, onnotice: () => {} });
}

type RegisteredPostgresClient = ReturnType<typeof postgres>;

/**
 * Derives a registry key from a connection URL's host and port only. We must
 * not retain or log the full URL, because it carries credentials.
 */
function hostPortKey(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}`;
}

/**
 * Same as `hostPortKey`, but returns `null` instead of throwing when the URL
 * does not parse. `postgres(url)` tolerates a value `new URL()` rejects (an
 * empty string falls back to the `PG*` environment variables), so `createDb`
 * must tolerate it too: skip the registry entry and let the driver decide
 * the outcome, instead of throwing an error the driver itself would not.
 */
function hostPortKeyOrNull(url: string): string | null {
  try {
    return hostPortKey(url);
  } catch (error) {
    if (error instanceof TypeError && (error as NodeJS.ErrnoException).code === "ERR_INVALID_URL") return null;
    throw error;
  }
}

// Tracks every client `createDb` hands out, keyed by host and port, so a test
// fixture can end them before it stops the Postgres cluster they point at. A
// `WeakRef` plus `FinalizationRegistry` means a long-lived process (a real
// server) retains nothing extra: an unreferenced client is pruned on its own.
const clientsByHostPort = new Map<string, Set<WeakRef<RegisteredPostgresClient>>>();
const clientFinalizer = new FinalizationRegistry<{ hostPortKey: string; ref: WeakRef<RegisteredPostgresClient> }>(
  ({ hostPortKey, ref }) => {
    const refs = clientsByHostPort.get(hostPortKey);
    if (!refs) return;
    refs.delete(ref);
    if (refs.size === 0) clientsByHostPort.delete(hostPortKey);
  },
);

function registerClient(key: string, client: RegisteredPostgresClient): void {
  const ref = new WeakRef(client);
  let refs = clientsByHostPort.get(key);
  if (!refs) {
    refs = new Set();
    clientsByHostPort.set(key, refs);
  }
  refs.add(ref);
  clientFinalizer.register(client, { hostPortKey: key, ref }, ref);
}

/**
 * Ends every live client `createDb` handed out for the given URL's host and
 * port, then forgets them. Call this before stopping a Postgres cluster: a
 * client that outlives the cluster it points at can crash the process (a
 * reserved connection's deferred write firing after the socket is gone).
 * Swallows individual `end()` errors so one bad client cannot block the rest.
 */
export async function closeRegisteredClients(url: string): Promise<void> {
  const key = hostPortKey(url);
  const refs = clientsByHostPort.get(key);
  if (!refs) return;

  clientsByHostPort.delete(key);
  const clients: RegisteredPostgresClient[] = [];
  for (const ref of refs) {
    clientFinalizer.unregister(ref);
    const client = ref.deref();
    if (client) clients.push(client);
  }

  await Promise.all(clients.map((client) => client.end({ timeout: 1 }).catch(() => {})));
}

function isSafeIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function quoteIdentifier(value: string): string {
  if (!isSafeIdentifier(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function splitMigrationStatements(content: string): string[] {
  return content
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

// Keep migration identity stable across the line-ending conversion that occurs
// when an existing Windows checkout is upgraded. The published migration text
// stays untouched; aliases are only used while reconciling old journals.
function hashMigrationContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function migrationContentHashAliases(content: string): string[] {
  const normalizedLf = content.replace(/\r\n?/g, "\n");
  const normalizedCrlf = normalizedLf.replaceAll("\n", "\r\n");
  return [...new Set([content, normalizedLf, normalizedCrlf].map(hashMigrationContent))];
}

export type MigrationState =
  | {
      status: "upToDate";
      tableCount: number;
      availableMigrations: string[];
      appliedMigrations: string[];
      journalEntryCount: number;
    }
  | {
      status: "needsMigrations";
      tableCount: number;
      availableMigrations: string[];
      appliedMigrations: string[];
      pendingMigrations: string[];
      journalEntryCount: number;
      reason: "no-migration-journal-empty-db" | "no-migration-journal-non-empty-db" | "pending-migrations";
    };

export interface DatabaseClientOptions {
  /**
   * postgres.js `prepare`. Set false when connecting through a
   * transaction-mode pooler (pgbouncer / Neon `-pooler` endpoints /
   * Supabase Supavisor transaction ports) so the client does not rely on
   * session-scoped prepared statements. Defaults to the driver default
   * (enabled), preserving existing behavior on direct connections.
   */
  prepare?: boolean;
  /** postgres.js `max` — connection pool size (driver default: 10). */
  maxConnections?: number;
  /** postgres.js `idle_timeout` in seconds (driver default: disabled). */
  idleTimeoutSeconds?: number;
  /** postgres.js `connect_timeout` in seconds (driver default: 30). */
  connectTimeoutSeconds?: number;
  /**
   * postgres.js `max_lifetime` in seconds. Bounds how long one pooled
   * connection is reused before the client replaces it (driver default: a
   * random value between 30 and 60 minutes).
   */
  maxLifetimeSeconds?: number;
  /**
   * postgres.js `connection.application_name`, shown in
   * `pg_stat_activity.application_name`. Lets an operator tell Paperclip's
   * pool apart from other clients of the same database (driver default:
   * `postgres.js`).
   */
  applicationName?: string;
}

/**
 * Idle pooled connections close after this many seconds unless
 * `DATABASE_IDLE_TIMEOUT_SECONDS` says otherwise. The driver default keeps an
 * idle connection open forever, so a process that stops issuing queries still
 * holds every backend it ever opened. Set `DATABASE_IDLE_TIMEOUT_SECONDS=0`
 * to restore the driver default.
 */
export const DEFAULT_DATABASE_IDLE_TIMEOUT_SECONDS = 60;
/** `application_name` reported to PostgreSQL unless `DATABASE_APPLICATION_NAME` overrides it. */
export const DEFAULT_DATABASE_APPLICATION_NAME = "paperclip";

function envBoolean(env: NodeJS.ProcessEnv, name: string): boolean | undefined {
  const value = env[name]?.trim().toLowerCase();
  if (value === undefined || value === "") return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be "true" or "false", got: ${env[name]}`);
}

function envPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^[1-9]\d*$/.test(value)) {
    throw new Error(`${name} must be a positive integer, got: ${env[name]}`);
  }
  return Number.parseInt(value, 10);
}

function envNonNegativeInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new Error(`${name} must be a non-negative integer, got: ${env[name]}`);
  }
  return Number.parseInt(value, 10);
}

function envNonEmptyString(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name]?.trim();
  if (value === undefined || value === "") return undefined;
  return value;
}

/**
 * Database client tuning from the environment, so hosted deployments can
 * adapt to their connection topology (pooled endpoints, network latency)
 * without editing source. Every variable is optional. This function returns
 * only the values the environment sets; `resolveDatabaseClientOptions` adds
 * Paperclip's own defaults on top, and the driver defaults apply to the rest
 * — self-hosted setups need none of these.
 */
export function databaseClientOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): DatabaseClientOptions {
  const options: DatabaseClientOptions = {};
  const prepare = envBoolean(env, "DATABASE_PREPARED_STATEMENTS");
  if (prepare !== undefined) options.prepare = prepare;
  const maxConnections = envPositiveInteger(env, "DATABASE_POOL_MAX");
  if (maxConnections !== undefined) options.maxConnections = maxConnections;
  // `0` is allowed here: it disables idle reaping (the driver default).
  const idleTimeoutSeconds = envNonNegativeInteger(env, "DATABASE_IDLE_TIMEOUT_SECONDS");
  if (idleTimeoutSeconds !== undefined) options.idleTimeoutSeconds = idleTimeoutSeconds;
  const connectTimeoutSeconds = envPositiveInteger(env, "DATABASE_CONNECT_TIMEOUT_SECONDS");
  if (connectTimeoutSeconds !== undefined) options.connectTimeoutSeconds = connectTimeoutSeconds;
  const maxLifetimeSeconds = envPositiveInteger(env, "DATABASE_MAX_LIFETIME_SECONDS");
  if (maxLifetimeSeconds !== undefined) options.maxLifetimeSeconds = maxLifetimeSeconds;
  const applicationName = envNonEmptyString(env, "DATABASE_APPLICATION_NAME");
  if (applicationName !== undefined) options.applicationName = applicationName;
  return options;
}

/**
 * Fills in Paperclip's defaults for the options the caller left unset: idle
 * connections are reaped after `DEFAULT_DATABASE_IDLE_TIMEOUT_SECONDS`, and the
 * pool identifies itself as `DEFAULT_DATABASE_APPLICATION_NAME`. Everything
 * else stays at the driver default. An explicit value (including
 * `idleTimeoutSeconds: 0`) always wins over the default.
 */
export function resolveDatabaseClientOptions(options: DatabaseClientOptions): DatabaseClientOptions {
  return {
    ...options,
    idleTimeoutSeconds: options.idleTimeoutSeconds ?? DEFAULT_DATABASE_IDLE_TIMEOUT_SECONDS,
    applicationName: options.applicationName ?? DEFAULT_DATABASE_APPLICATION_NAME,
  };
}

export function postgresJsOptions(options: DatabaseClientOptions): Record<string, unknown> {
  const driverOptions: Record<string, unknown> = {};
  if (options.prepare !== undefined) driverOptions.prepare = options.prepare;
  if (options.maxConnections !== undefined) driverOptions.max = options.maxConnections;
  if (options.idleTimeoutSeconds !== undefined) driverOptions.idle_timeout = options.idleTimeoutSeconds;
  if (options.connectTimeoutSeconds !== undefined) driverOptions.connect_timeout = options.connectTimeoutSeconds;
  if (options.maxLifetimeSeconds !== undefined) driverOptions.max_lifetime = options.maxLifetimeSeconds;
  if (options.applicationName !== undefined) {
    driverOptions.connection = { application_name: options.applicationName };
  }
  return driverOptions;
}

// A long advisory-lock transaction must not borrow the normal pool that its
// work needs for progress writes. Keep connection configuration private to the
// originating Db lifetime; callers receive neither URLs nor credentials.
const dedicatedDbFactories = new WeakMap<object, () => Db>();

export async function withDedicatedDbConnection<T>(db: Db, action: (dedicated: Db) => Promise<T>): Promise<T> {
  const factory = dedicatedDbFactories.get(db);
  if (!factory) throw new Error("dedicated_connection_requires_create_db");
  const dedicated = factory();
  try { return await action(dedicated); }
  finally { await dedicated.$client.end({ timeout: 1 }); }
}

// postgres.js pipelines a query onto a busy connection when none is idle, so
// a short liveness write can wait behind an unrelated slow statement with no
// client-side bound. Liveness writes (controller-lease renewal) get a small
// private pool, created on first use and shared for the owner's lifetime.
const livenessDbFactories = new WeakMap<object, () => Db>();
const livenessDbs = new WeakMap<object, Db>();
const LIVENESS_POOL_MAX_CONNECTIONS = 2;

/** The private liveness pool for a `createDb` client; other clients (test
 * doubles, transactions) are returned unchanged. */
export function livenessDb(db: Db): Db {
  const existing = livenessDbs.get(db);
  if (existing) return existing;
  const factory = livenessDbFactories.get(db);
  if (!factory) return db;
  const created = factory();
  livenessDbs.set(db, created);
  return created;
}

/** Ends the liveness pool if one was created. The ended pool stays cached, so
 * a late renewal fails like a query on the ended primary pool. */
export async function closeLivenessDb(db: Db, timeoutSeconds: number): Promise<void> {
  await livenessDbs.get(db)?.$client.end({ timeout: timeoutSeconds });
}

export function createDb(url: string, options?: DatabaseClientOptions) {
  const resolved = resolveDatabaseClientOptions(options ?? databaseClientOptionsFromEnv());
  return createDbClient(url, resolved);
}

function createDbClient(url: string, resolved: DatabaseClientOptions, owner?: object) {
  const sql = postgres(url, postgresJsOptions(resolved));
  const key = hostPortKeyOrNull(url);
  if (key) registerClient(key, sql);
  // A disconnect can lose the response after a statement has committed.
  // postgres.js calls that error "write CONNECTION_CLOSED" too, so the
  // message cannot establish that replay is safe. Leave retries to callers
  // that know the complete operation is idempotent.
  const db = installDatabaseWorkSignals(drizzlePg(sql, { schema }), owner);
  dedicatedDbFactories.set(db, () => createDbClient(url, {
    ...resolved, maxConnections: 1, applicationName: "paperclip-workspace-finalization-lock",
  }, db));
  livenessDbFactories.set(db, () => createDbClient(url, {
    ...resolved, maxConnections: LIVENESS_POOL_MAX_CONNECTIONS, applicationName: "paperclip-controller-lease",
  }, db));
  return db;
}

export async function getPostgresDataDirectory(url: string): Promise<string | null> {
  const sql = createUtilitySql(url);
  try {
    const rows = await sql<{ data_directory: string | null }[]>`
      SELECT current_setting('data_directory', true) AS data_directory
    `;
    const actual = rows[0]?.data_directory;
    return typeof actual === "string" && actual.length > 0 ? actual : null;
  } catch {
    return null;
  } finally {
    await sql.end();
  }
}

async function listMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_FOLDER, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

type MigrationJournalFile = {
  entries?: Array<{ idx?: number; tag?: string; when?: number }>;
};

type JournalMigrationEntry = {
  fileName: string;
  folderMillis: number;
  order: number;
};

async function listJournalMigrationEntries(): Promise<JournalMigrationEntry[]> {
  try {
    const raw = await readFile(MIGRATIONS_JOURNAL_JSON, "utf8");
    const parsed = JSON.parse(raw) as MigrationJournalFile;
    if (!Array.isArray(parsed.entries)) return [];
    return parsed.entries
      .map((entry, entryIndex) => {
        if (typeof entry?.tag !== "string") return null;
        if (typeof entry?.when !== "number" || !Number.isFinite(entry.when)) return null;
        const order = Number.isInteger(entry.idx) ? Number(entry.idx) : entryIndex;
        return { fileName: `${entry.tag}.sql`, folderMillis: entry.when, order };
      })
      .filter((entry): entry is JournalMigrationEntry => entry !== null);
  } catch {
    return [];
  }
}

async function listJournalMigrationFiles(): Promise<string[]> {
  const entries = await listJournalMigrationEntries();
  return entries.map((entry) => entry.fileName);
}

async function readMigrationFileContent(migrationFile: string): Promise<string> {
  return readFile(new URL(`./migrations/${migrationFile}`, import.meta.url), "utf8");
}

async function orderMigrationsByJournal(migrationFiles: string[]): Promise<string[]> {
  const journalEntries = await listJournalMigrationEntries();
  const orderByFileName = new Map(journalEntries.map((entry) => [entry.fileName, entry.order]));
  return [...migrationFiles].sort((left, right) => {
    const leftOrder = orderByFileName.get(left);
    const rightOrder = orderByFileName.get(right);
    if (leftOrder === undefined && rightOrder === undefined) return left.localeCompare(right);
    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    if (leftOrder === rightOrder) return left.localeCompare(right);
    return leftOrder - rightOrder;
  });
}

type SqlExecutor = Pick<ReturnType<typeof postgres>, "unsafe">;

async function runInTransaction(sql: SqlExecutor, action: () => Promise<void>): Promise<void> {
  await sql.unsafe("BEGIN");
  try {
    await action();
    await sql.unsafe("COMMIT");
  } catch (error) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      // Ignore rollback failures and surface the original error.
    }
    throw error;
  }
}

async function latestMigrationCreatedAt(
  sql: SqlExecutor,
  qualifiedTable: string,
): Promise<number | null> {
  const rows = await sql.unsafe<{ created_at: string | number | null }[]>(
    `SELECT created_at FROM ${qualifiedTable} ORDER BY created_at DESC NULLS LAST LIMIT 1`,
  );
  const value = Number(rows[0]?.created_at ?? Number.NaN);
  return Number.isFinite(value) ? value : null;
}

function normalizeFolderMillis(value: number | null | undefined): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.trunc(value);
  }
  return Date.now();
}

async function ensureMigrationJournalTable(
  sql: ReturnType<typeof postgres>,
): Promise<{ migrationTableSchema: string; columnNames: Set<string> }> {
  let migrationTableSchema = await discoverMigrationTableSchema(sql);
  if (!migrationTableSchema) {
    const drizzleSchema = quoteIdentifier("drizzle");
    const migrationTable = quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE);
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${drizzleSchema}`);
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${drizzleSchema}.${migrationTable} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`,
    );
    migrationTableSchema = (await discoverMigrationTableSchema(sql)) ?? "drizzle";
  }

  const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);
  return { migrationTableSchema, columnNames };
}

async function migrationHistoryEntryExists(
  sql: SqlExecutor,
  qualifiedTable: string,
  columnNames: Set<string>,
  migrationFile: string,
  hashes: readonly string[],
): Promise<boolean> {
  const predicates: string[] = [];
  if (columnNames.has("hash") && hashes.length > 0) {
    predicates.push(`hash IN (${hashes.map(quoteLiteral).join(", ")})`);
  }
  if (columnNames.has("name")) predicates.push(`name = ${quoteLiteral(migrationFile)}`);
  if (predicates.length === 0) return false;

  const rows = await sql.unsafe<{ one: number }[]>(
    `SELECT 1 AS one FROM ${qualifiedTable} WHERE ${predicates.join(" OR ")} LIMIT 1`,
  );
  return rows.length > 0;
}

async function recordMigrationHistoryEntry(
  sql: SqlExecutor,
  qualifiedTable: string,
  columnNames: Set<string>,
  migrationFile: string,
  hash: string,
  folderMillis: number,
): Promise<void> {
  const insertColumns: string[] = [];
  const insertValues: string[] = [];

  if (columnNames.has("hash")) {
    insertColumns.push(quoteIdentifier("hash"));
    insertValues.push(quoteLiteral(hash));
  }
  if (columnNames.has("name")) {
    insertColumns.push(quoteIdentifier("name"));
    insertValues.push(quoteLiteral(migrationFile));
  }
  if (columnNames.has("created_at")) {
    const latestCreatedAt = await latestMigrationCreatedAt(sql, qualifiedTable);
    const createdAt = latestCreatedAt === null
      ? normalizeFolderMillis(folderMillis)
      : Math.max(latestCreatedAt + 1, normalizeFolderMillis(folderMillis));
    insertColumns.push(quoteIdentifier("created_at"));
    insertValues.push(quoteLiteral(String(createdAt)));
  }

  if (insertColumns.length === 0) return;

  await sql.unsafe(
    `INSERT INTO ${qualifiedTable} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
  );
}

// These idempotent migrations require top-level statements for batch commits
// or concurrent index builds. History is recorded only after completion.
const MIGRATIONS_WITH_TOP_LEVEL_STATEMENTS = new Set([
  "0313_private_task_access.sql",
  "0314_private_task_draft_assets.sql",
  "0332_little_night_nurse.sql",
  "0345_luxuriant_carmella_unuscione.sql",
  "0369_late_logan.sql",
]);

async function applyPendingMigrationsManually(
  url: string,
  pendingMigrations: string[],
  verifyExistingMigrationState = true,
): Promise<void> {
  if (pendingMigrations.length === 0) return;

  const orderedPendingMigrations = await orderMigrationsByJournal(pendingMigrations);
  const journalEntries = await listJournalMigrationEntries();
  const folderMillisByFileName = new Map(
    journalEntries.map((entry) => [entry.fileName, normalizeFolderMillis(entry.folderMillis)]),
  );

  const pool = createUtilitySql(url);
  try {
    const sql = await pool.reserve();
    try {
      // A session lock survives each batch COMMIT. Reserve the connection so
      // pool rotation cannot release it while another migrator is waiting.
      // A blocking lock SELECT retains its statement snapshot while waiting.
      // A partial concurrent index build can wait for that snapshot, forming a
      // deadlock with this lock. Each failed try ends its snapshot before sleep.
      while (!(await sql<{ locked: boolean }[]>`
        SELECT pg_try_advisory_lock(hashtextextended('paperclip:migrations', 0)) AS locked`)[0]?.locked) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const { migrationTableSchema, columnNames } = await ensureMigrationJournalTable(sql);
      const qualifiedTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;

      for (const migrationFile of orderedPendingMigrations) {
        const migrationContent = await readMigrationFileContent(migrationFile);
        const hash = hashMigrationContent(migrationContent);
        const hashes = migrationContentHashAliases(migrationContent);
        const existingEntry = await migrationHistoryEntryExists(
          sql,
          qualifiedTable,
          columnNames,
          migrationFile,
          hashes,
        );
        if (existingEntry) continue;

        if (verifyExistingMigrationState) {
          const applicationState = await migrationContentApplicationState(sql, migrationContent);
          if (applicationState === "applied") {
            await runInTransaction(sql, async () => {
              await recordMigrationHistoryEntry(
                sql,
                qualifiedTable,
                columnNames,
                migrationFile,
                hash,
                folderMillisByFileName.get(migrationFile) ?? Date.now(),
              );
            });
            continue;
          }
          if (applicationState === "unsafe-replay") {
            throw new Error(
              `Refusing to replay migration ${migrationFile}: schema statements are already applied while migration history is missing or incompatible. Repair the migration journal from verified schema state before retrying.`,
            );
          }
        }

        const applyMigration = async () => {
          for (const statement of splitMigrationStatements(migrationContent)) {
            if (MIGRATIONS_WITH_TOP_LEVEL_STATEMENTS.has(migrationFile)) {
              // A cancelled concurrent build leaves an invalid index. IF NOT
              // EXISTS alone would skip it on retry and journal an incomplete index.
              const index = statement.replace(/^\s*--.*$/gm, "").trim()
                .match(/^CREATE (?:UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS "([A-Za-z_][A-Za-z0-9_]*)"/i);
              if (index) {
                const invalid = await sql<{ invalid: boolean }[]>`
                  SELECT NOT i.indisvalid AS invalid FROM pg_index i
                  JOIN pg_class c ON c.oid = i.indexrelid
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relname = ${index[1]}`;
                if (invalid[0]?.invalid) {
                  await sql.unsafe(`DROP INDEX CONCURRENTLY ${quoteIdentifier("public")}.${quoteIdentifier(index[1])}`);
                }
              }
            }
            // Older dev schemas can lack a replaced constraint. Preserve the
            // published SQL/hash while allowing the harmless drop to proceed.
            const executable = statement.replace(
              /^(\s*ALTER TABLE "[^"]+" DROP CONSTRAINT) (?!IF EXISTS\b)/i,
              "$1 IF EXISTS ",
            );
            await sql.unsafe(executable);
          }

          await recordMigrationHistoryEntry(
            sql,
            qualifiedTable,
            columnNames,
            migrationFile,
            hash,
            folderMillisByFileName.get(migrationFile) ?? Date.now(),
          );
        };
        if (MIGRATIONS_WITH_TOP_LEVEL_STATEMENTS.has(migrationFile)) {
          await applyMigration();
        } else {
          await runInTransaction(sql, applyMigration);
        }
      }
    } finally {
      try {
        await sql`SELECT pg_advisory_unlock(hashtextextended('paperclip:migrations', 0))`;
      } catch {
        // Preserve the migration error if the session died; PostgreSQL releases
        // its lock on disconnect, and pool.end() closes any remaining connection.
      }
      sql.release();
    }
  } finally {
    await pool.end();
  }
}

async function mapHashesToMigrationFiles(migrationFiles: string[]): Promise<Map<string, string>> {
  const mapped = new Map<string, string>();

  await Promise.all(
    migrationFiles.map(async (migrationFile) => {
      const content = await readMigrationFileContent(migrationFile);
      for (const hash of migrationContentHashAliases(content)) {
        mapped.set(hash, migrationFile);
      }
      if (migrationFile === "0355_agent_tool_definition_hooks.sql") {
        mapped.set("7ac76adac0220da522c78e51da20490aeb0f90512b4370a05af9f8dd0f75eda6", migrationFile);
      }
    }),
  );

  return mapped;
}

async function getMigrationTableColumnNames(
  sql: ReturnType<typeof postgres>,
  migrationTableSchema: string,
): Promise<Set<string>> {
  const columns = await sql.unsafe<{ column_name: string }[]>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = ${quoteLiteral(migrationTableSchema)}
        AND table_name = ${quoteLiteral(DRIZZLE_MIGRATIONS_TABLE)}
    `,
  );
  return new Set(columns.map((column) => column.column_name));
}

async function tableExists(
  sql: ReturnType<typeof postgres>,
  tableName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function columnExists(
  sql: ReturnType<typeof postgres>,
  tableName: string,
  columnName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ${tableName}
        AND column_name = ${columnName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function columnHasDataType(
  sql: ReturnType<typeof postgres>,
  tableName: string,
  columnName: string,
  dataType: string,
  numericPrecision?: number,
  numericScale?: number,
): Promise<boolean> {
  const rows = await sql<{
    dataType: string;
    udtName: string;
    numericPrecision: number | null;
    numericScale: number | null;
  }[]>`
    SELECT
      data_type AS "dataType",
      udt_name AS "udtName",
      numeric_precision AS "numericPrecision",
      numeric_scale AS "numericScale"
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = ${tableName}
      AND column_name = ${columnName}
  `;
  const expected = dataType.toLowerCase();
  return rows.some((row) => {
    const matchesType = row.dataType.toLowerCase() === expected
      || row.udtName.toLowerCase() === expected;
    if (!matchesType) return false;
    if (numericPrecision !== undefined && row.numericPrecision !== numericPrecision) return false;
    if (numericScale !== undefined && row.numericScale !== numericScale) return false;
    return true;
  });
}

type IndexDefinitionParts = {
  unique: boolean;
  name: string;
  table: string;
  method: string;
  keys: string;
  predicate: string | null;
};

function parseIndexDefinition(value: string): IndexDefinitionParts | null {
  const normalized = value.replace(/\s+/g, " ").trim().replace(/;$/, "");
  // pg_get_indexdef wraps partial predicates in parentheses. Split it before
  // parsing key parentheses so a predicate's closing parenthesis cannot be
  // mistaken for part of the index key list.
  const whereMatch = normalized.match(/\s+WHERE\s+(.+)$/i);
  const indexDefinition = whereMatch
    ? normalized.slice(0, whereMatch.index).trim()
    : normalized;
  const match = indexDefinition.match(
    /^CREATE\s+(UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+"?([A-Za-z_][A-Za-z0-9_]*)"?\s+ON\s+(?:"?public"?\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?(?:\s+USING\s+([A-Za-z0-9_]+))?\s+\((.*)\)$/i,
  );
  if (!match) return null;
  return {
    unique: Boolean(match[1]),
    name: match[2]!,
    table: match[3]!,
    // PostgreSQL emits the default btree method, while migration DDL may
    // omit it. They describe the same index method.
    method: match[4] ?? "btree",
    keys: match[5]!,
    predicate: whereMatch?.[1] ?? null,
  };
}

function normalizeIndexKeys(value: string): string {
  return value.replace(/"/g, "").replace(/\s+/g, "").toLowerCase();
}

function stripOuterParentheses(value: string): string {
  let normalized = value.trim();
  while (normalized.startsWith("(") && normalized.endsWith(")")) {
    let depth = 0;
    let enclosesWholeExpression = true;
    for (let index = 0; index < normalized.length - 1; index += 1) {
      const character = normalized[index]!;
      if (character === "(") depth += 1;
      if (character === ")") depth -= 1;
      if (depth === 0) {
        enclosesWholeExpression = false;
        break;
      }
    }
    if (!enclosesWholeExpression) break;
    normalized = normalized.slice(1, -1).trim();
  }
  return normalized;
}

function normalizeArrayElementSeparators(value: string): string {
  let normalized = "", quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted && character === "'" && value[index + 1] === "'") {
      normalized += "''";
      index += 1;
      continue;
    }
    if (character === "'") quoted = !quoted;
    if (!quoted && character === ",") {
      normalized = normalized.trimEnd() + ",";
      while (/\s/.test(value[index + 1] ?? "")) index += 1;
      continue;
    }
    normalized += character;
  }
  return normalized;
}

function normalizeIndexPredicate(value: string | null): string | null {
  if (value === null) return null;
  let normalized = stripOuterParentheses(value)
    .replace(/"/g, "")
    .replace(/::[A-Za-z_][A-Za-z0-9_ ]*(?:\[\])?/g, "")
    // pg_get_indexdef omits the indexed table qualifier in partial-index
    // predicates. The migration DDL keeps it, so compare the same expression
    // shape after removing that syntactic qualifier.
    .replace(/\b[A-Za-z_][A-Za-z0-9_]*\./g, "")
    // PostgreSQL canonicalizes `NOT IN (...)` as `<> ALL (ARRAY[...])` in
    // pg_get_indexdef. Normalize both spellings before comparing predicates.
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s+NOT\s+IN\s+\(([^()]*)\)/gi, "$1 <> ALL ARRAY[$2]")
    .replace(/<>\s+ALL\s+\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi, "<> ALL ARRAY[$1]")
    // Likewise, PostgreSQL canonicalizes `IN (...)` as `= ANY (ARRAY[...])`.
    // The two forms describe the same partial-index predicate.
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*)\s+IN\s+\(([^()]*)\)/gi, "$1 = ANY ARRAY[$2]")
    .replace(/=\s+ANY\s+\(\s*ARRAY\s*\[([^\]]*)\]\s*\)/gi, "= ANY ARRAY[$1]")
    .replace(/\bARRAY\s*\[([^\]]*)\]/gi, (_match, contents: string) => `ARRAY[${normalizeArrayElementSeparators(contents)}]`)
    // PostgreSQL renders the SQL LIKE operator as its internal `~~` token in
    // pg_get_indexdef. This is a direct spelling equivalence, not a broader
    // predicate rewrite.
    .replace(/\s+~~\s+/g, " LIKE ")
    // The canonical form may wrap an `<> ALL (ARRAY[...])` term on its own.
    // That pair of parentheses changes no precedence, unlike parentheses
    // around a compound boolean expression.
    .replace(/\(\s*([A-Za-z_][A-Za-z0-9_]*\s+<>\s+ALL\s+ARRAY\s*\[[^\]]*\])\s*\)/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  // pg_get_indexdef adds parentheses around each simple comparison in compound
  // predicates. Remove only parenthesized expressions without AND/OR, leaving
  // grouping that changes boolean precedence intact.
  let previous: string;
  do {
    previous = normalized;
    normalized = normalized.replace(/\(([^()]*)\)/g, (match, contents: string) =>
      /\b(?:AND|OR|ARRAY)\b/i.test(contents) || contents.includes(",") ? match : contents.trim(),
    );
  } while (normalized !== previous);
  return stripOuterParentheses(normalized).replace(/\s+/g, " ").trim().toLowerCase();
}

async function inspectIndexDefinition(
  sql: ReturnType<typeof postgres>,
  indexName: string,
  expectedStatement: string,
): Promise<"absent" | "matching" | "mismatched"> {
  const expected = parseIndexDefinition(expectedStatement);
  if (!expected) return "mismatched";
  const rows = await sql<{ definition: string }[]>`
    SELECT pg_get_indexdef(i.indexrelid) AS definition
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indexrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = ${indexName}
  `;
  if (!rows[0]?.definition) return "absent";
  const actual = parseIndexDefinition(rows[0].definition);
  if (!actual) return "mismatched";
  return actual.unique === expected.unique
    && actual.name === expected.name
    && actual.table === expected.table
    && actual.method.toLowerCase() === expected.method.toLowerCase()
    && normalizeIndexKeys(actual.keys) === normalizeIndexKeys(expected.keys)
    && normalizeIndexPredicate(actual.predicate) === normalizeIndexPredicate(expected.predicate)
    ? "matching"
    : "mismatched";
}

async function constraintExists(
  sql: ReturnType<typeof postgres>,
  constraintName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'public'
        AND c.conname = ${constraintName}
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function constraintNameExistsAnywhere(
  sql: ReturnType<typeof postgres>,
  constraintName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = ${constraintName}) AS exists
  `;
  return rows[0]?.exists ?? false;
}

function normalizeConstraintDefinition(value: string): string {
  return value
    .replace(/"/g, "")
    .replace(/\bpublic\./gi, "")
    .replace(/\s+/g, " ")
    .replace(/;$/, "")
    .trim()
    .toLowerCase()
    // PostgreSQL omits the default action from pg_get_constraintdef.
    .replace(/\s+on update no action\b/g, "")
    .replace(/\s+on delete no action\b/g, "")
    // pg_get_constraintdef adds spaces after commas in composite FK column
    // lists. This normalizes punctuation only after the FK parser has
    // isolated the definition, so quoted literals are never rewritten.
    .replace(/\s*,\s*/g, ",")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");
}

async function inspectGuardedForeignKey(
  sql: ReturnType<typeof postgres>,
  tableName: string,
  constraintName: string,
  expectedDefinition: string,
): Promise<"absent" | "matching" | "mismatched"> {
  const rows = await sql<{ definition: string; type: string }[]>`
    SELECT pg_get_constraintdef(c.oid) AS definition, c.contype AS type
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = ${tableName}
      AND c.conname = ${constraintName}
  `;
  if (rows.length === 0) return "absent";
  const actualDefinition = normalizeConstraintDefinition(rows[0]!.definition);
  const normalizedExpected = normalizeConstraintDefinition(expectedDefinition);
  // 0217 deliberately replaced this 0047 FK's delete action. A restored
  // database with the published successor is complete; this exception names
  // both the relation and constraint so it cannot authorize another FK.
  const isPublishedFeedbackVoteSuccessor = tableName === "feedback_votes"
    && constraintName === "feedback_votes_issue_id_issues_id_fk"
    && normalizedExpected === "foreign key (issue_id) references issues(id)"
    && actualDefinition === "foreign key (issue_id) references issues(id) on delete cascade";
  const hasPublishedSuccessorHistory = isPublishedFeedbackVoteSuccessor
    && (await (async () => {
      const successorHashes = migrationContentHashAliases(
        await readMigrationFileContent("0217_yielding_starbolt.sql"),
      );
      const history = await sql<{ exists: boolean }[]>`
        SELECT EXISTS (SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE hash = ANY(${successorHashes})) AS exists
      `;
      return history[0]?.exists ?? false;
    })());
  return rows.length === 1
    && rows[0]!.type === "f"
    && (actualDefinition === normalizedExpected || hasPublishedSuccessorHistory)
    ? "matching"
    : "mismatched";
}

async function triggerExists(
  sql: ReturnType<typeof postgres>,
  triggerName: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND t.tgname = ${triggerName}
        AND NOT t.tgisinternal
    ) AS exists
  `;
  return rows[0]?.exists ?? false;
}

async function heartbeatEventSequencesAreUnique(
  sql: ReturnType<typeof postgres>,
): Promise<boolean> {
  const rows = await sql<{ unique: boolean }[]>`
    SELECT NOT EXISTS (
      SELECT 1
      FROM heartbeat_run_events
      GROUP BY run_id, seq
      HAVING count(*) > 1
    ) AS unique
  `;
  return rows[0]?.unique ?? false;
}

async function heartbeatNextEventSequencesAreCurrent(
  sql: ReturnType<typeof postgres>,
): Promise<boolean> {
  if (!(await columnExists(sql, "heartbeat_runs", "next_event_seq"))) return false;
  const rows = await sql<{ current: boolean }[]>`
    SELECT NOT EXISTS (
      SELECT 1
      FROM heartbeat_runs run
      WHERE run.next_event_seq IS DISTINCT FROM COALESCE((
        SELECT max(event.seq) + 1
        FROM heartbeat_run_events event
        WHERE event.run_id = run.id
      ), 1)
    ) AS current
  `;
  return rows[0]?.current ?? false;
}

type MigrationStatementInspection = {
  state: "applied" | "not-applied" | "unknown";
  replaySafeWhenApplied: boolean;
};

type MigrationContentApplicationState = "applied" | "replayable" | "unsafe-replay";

async function migrationStatementApplicationState(
  sql: ReturnType<typeof postgres>,
  statement: string,
): Promise<MigrationStatementInspection> {
  const normalized = statement
    .replace(/^\s*--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();

  const createTableMatch = normalized.match(/^CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createTableMatch) {
    return {
      state: (await tableExists(sql, createTableMatch[1])) ? "applied" : "not-applied",
      replaySafeWhenApplied: /^CREATE TABLE IF NOT EXISTS /i.test(normalized),
    };
  }

  const addColumnMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" ADD COLUMN(?: IF NOT EXISTS)? "([^"]+)"/i,
  );
  if (addColumnMatch) {
    return {
      state: (await columnExists(sql, addColumnMatch[1], addColumnMatch[2])) ? "applied" : "not-applied",
      replaySafeWhenApplied: / ADD COLUMN IF NOT EXISTS /i.test(normalized),
    };
  }

  const alterColumnTypeMatch = normalized.match(
    /^ALTER TABLE "([^"]+)" ALTER COLUMN "([^"]+)" SET DATA TYPE ([A-Za-z0-9_]+)(?:\((\d+)(?:\s*,\s*(\d+))?\))?/i,
  );
  if (alterColumnTypeMatch) {
    return {
      state: (await columnHasDataType(
        sql,
        alterColumnTypeMatch[1],
        alterColumnTypeMatch[2],
        alterColumnTypeMatch[3],
        alterColumnTypeMatch[4] === undefined ? undefined : Number(alterColumnTypeMatch[4]),
        alterColumnTypeMatch[5] === undefined ? undefined : Number(alterColumnTypeMatch[5]),
      ))
        ? "applied"
        : "not-applied",
      // Reapplying an ALTER ... SET DATA TYPE statement after the exact target
      // type is present is a PostgreSQL no-op. It must not block a later
      // replay-safe statement in the same migration from repairing its schema.
      replaySafeWhenApplied: true,
    };
  }

  const createIndexMatch = normalized.match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/i);
  if (createIndexMatch) {
    const indexState = await inspectIndexDefinition(sql, createIndexMatch[1], normalized);
    return {
      state: indexState === "absent" ? "not-applied" : "applied",
      replaySafeWhenApplied:
        indexState === "matching"
        && /^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS /i.test(normalized),
    };
  }

  const addConstraintMatch = normalized.match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i);
  if (addConstraintMatch) {
    return {
      state: (await constraintExists(sql, addConstraintMatch[2])) ? "applied" : "not-applied",
      replaySafeWhenApplied: false,
    };
  }

  const createFunctionMatch = normalized.match(
    /^CREATE OR REPLACE FUNCTION "?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/i,
  );
  if (createFunctionMatch) {
    return {
      // CREATE OR REPLACE is deliberately a repair operation: an existing
      // name does not prove that its body is current, so execute it again.
      state: "not-applied",
      replaySafeWhenApplied: true,
    };
  }

  const createTriggerMatch = normalized.match(
    /^CREATE TRIGGER "?([A-Za-z_][A-Za-z0-9_]*)"?/i,
  );
  if (createTriggerMatch) {
    return {
      state: (await triggerExists(sql, createTriggerMatch[1])) ? "applied" : "not-applied",
      replaySafeWhenApplied: false,
    };
  }

  // Drizzle emits idempotent foreign keys as guarded anonymous blocks. The
  // block is replay-safe only when its guard names the same constraint that
  // the body adds; do not infer safety for arbitrary procedural SQL.
  const guardedConstraintMatch = normalized.match(
    /^DO \$\$ BEGIN IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE ([\s\S]*?)\) THEN ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)" (FOREIGN KEY \([\s\S]+?\) REFERENCES [\s\S]+? ON DELETE [\s\S]+? ON UPDATE [\s\S]+?);? (?:EXCEPTION|END)/i,
  );
  if (
    guardedConstraintMatch
    && /^conname = '([^']+)'(?:\s+AND\s+conrelid\s*=\s*[^\s]+)?$/i.test(guardedConstraintMatch[1])
  ) {
    const guardName = /^conname = '([^']+)'/i.exec(guardedConstraintMatch[1])![1]!;
    const foreignKeyState = await inspectGuardedForeignKey(
      sql,
      guardedConstraintMatch[2],
        guardName,
      guardedConstraintMatch[4],
    );
    return {
      state: foreignKeyState === "absent"
        && !/\bconrelid\b/i.test(guardedConstraintMatch[1])
        && await constraintNameExistsAnywhere(sql, guardName)
        ? "applied"
        : foreignKeyState === "absent" ? "not-applied" : "applied",
      replaySafeWhenApplied: foreignKeyState === "matching",
    };
  }

  // These native-runner repairs have persistent postconditions. Verify them
  // instead of replaying them when a restored database is missing only the
  // migration-history row.
  if (
    normalized.startsWith("WITH ranked AS (")
    && normalized.includes('UPDATE "heartbeat_run_events" AS event')
  ) {
    return {
      state: (await heartbeatEventSequencesAreUnique(sql)) ? "applied" : "not-applied",
      // When every sequence is already unique, replaying the repair cannot
      // improve state. Recording the missing journal entry preserves the
      // invariant without rewriting event history.
      replaySafeWhenApplied: true,
    };
  }
  if (
    normalized.startsWith('UPDATE "heartbeat_runs" AS run')
    && normalized.includes('SET "next_event_seq" = COALESCE')
  ) {
    return {
      state: (await heartbeatNextEventSequencesAreCurrent(sql)) ? "applied" : "not-applied",
      // The derived counter is already exact, so a missing history entry can
      // be reconciled without another write.
      replaySafeWhenApplied: true,
    };
  }

  // If we cannot reason about a statement safely, require manual migration.
  return { state: "unknown", replaySafeWhenApplied: true };
}

async function migrationContentApplicationState(
  sql: ReturnType<typeof postgres>,
  migrationContent: string,
): Promise<MigrationContentApplicationState> {
  const statements = splitMigrationStatements(migrationContent);
  if (statements.length === 0) return "replayable";

  const inspections = await Promise.all(
    statements.map((statement) => migrationStatementApplicationState(sql, statement)),
  );
  // A migration can deliberately replace a legacy index with the same name.
  // Its preceding DROP INDEX makes the replacement safe to replay even when
  // the index is already present: treat the create as pending so the pair can
  // establish the published definition. Without the paired drop, a same-name
  // mismatch remains fail-closed.
  for (let index = 0; index < statements.length; index += 1) {
    const createdIndex = statements[index]
      .replace(/^\s*--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/i)?.[1];
    if (
      !createdIndex
      || inspections[index]?.state !== "applied"
      || inspections[index]?.replaySafeWhenApplied
    ) continue;
    const hasPrecedingDrop = statements.slice(0, index).some((statement) => {
      const droppedIndex = statement
        .replace(/^\s*--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .match(/^DROP INDEX(?: IF EXISTS)? "([^"]+)"/i)?.[1];
      return droppedIndex === createdIndex;
    });
    if (hasPrecedingDrop) {
      inspections[index] = { state: "not-applied", replaySafeWhenApplied: true };
    }
  }
  // A trigger replacement is another explicit drop-and-recreate unit. Keep
  // the relation in the comparison so an unrelated same-named trigger cannot
  // authorize replay.
  for (let index = 0; index < statements.length; index += 1) {
    const createdTrigger = statements[index]
      .replace(/^\s*--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/^CREATE TRIGGER "?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:BEFORE|AFTER|INSTEAD OF)\b[\s\S]*?\sON\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i);
    if (
      !createdTrigger
      || inspections[index]?.state !== "applied"
      || inspections[index]?.replaySafeWhenApplied
    ) continue;
    const [, triggerName, tableName] = createdTrigger;
    const hasPrecedingDrop = statements.slice(0, index).some((statement) => {
      const droppedTrigger = statement
        .replace(/^\s*--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .match(/^DROP TRIGGER IF EXISTS "?([A-Za-z_][A-Za-z0-9_]*)"? ON "?([A-Za-z_][A-Za-z0-9_]*)"?/i);
      return droppedTrigger?.[1] === triggerName && droppedTrigger[2] === tableName;
    });
    if (hasPrecedingDrop) {
      inspections[index] = { state: "not-applied", replaySafeWhenApplied: true };
    }
  }
  // A constraint replacement must run as a unit. Seeing the replacement name
  // already present is not proof that it has the target definition, but a
  // preceding drop on the same table makes replay safe: replay the pair to
  // establish the published definition. Constraints without that paired drop
  // remain fail-closed.
  for (let index = 0; index < statements.length; index += 1) {
    const addedConstraint = statements[index]
      .replace(/^\s*--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/^ALTER TABLE "([^"]+)" ADD CONSTRAINT "([^"]+)"/i);
    if (
      !addedConstraint
      || inspections[index]?.state !== "applied"
      || inspections[index]?.replaySafeWhenApplied
    ) continue;
    const [, tableName, constraintName] = addedConstraint;
    const hasPrecedingDrop = statements.slice(0, index).some((statement) => {
      const droppedConstraint = statement
        .replace(/^\s*--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .match(/^ALTER TABLE "([^"]+)" DROP CONSTRAINT(?: IF EXISTS)? "([^"]+)"/i);
      return droppedConstraint?.[1] === tableName && droppedConstraint[2] === constraintName;
    });
    if (hasPrecedingDrop) {
      inspections[index] = { state: "not-applied", replaySafeWhenApplied: true };
    }
  }
  // Some historical migrations replace an index with a two-statement
  // `DROP INDEX; CREATE ... INDEX` pair. The final matching index proves that
  // pair is already complete even though PostgreSQL exposes no durable record
  // for the drop itself. Treat that pair as replay-safe: an unrelated unknown
  // statement in the same migration may still require a safe replay, but the
  // inferred drop must not make it unsafe. A standalone drop remains unknown
  // and is never inferred from the current schema.
  for (let index = 0; index < statements.length; index += 1) {
    if (inspections[index]?.state !== "unknown") continue;
    const droppedIndex = statements[index]
      .replace(/^\s*--.*$/gm, "")
      .replace(/\s+/g, " ")
      .trim()
      .match(/^DROP INDEX(?: IF EXISTS)? "([^"]+)"/i)?.[1];
    if (!droppedIndex) continue;
    const recreated = statements.slice(index + 1).findIndex((statement, offset) => {
      const createdIndex = statement
        .replace(/^\s*--.*$/gm, "")
        .replace(/\s+/g, " ")
        .trim()
        .match(/^CREATE (?:UNIQUE )?INDEX(?: IF NOT EXISTS)? "([^"]+)"/i)?.[1];
      return createdIndex === droppedIndex && inspections[index + offset + 1]?.state === "applied";
    });
    if (recreated !== -1) {
      inspections[index] = { state: "applied", replaySafeWhenApplied: true };
    }
  }
  if (inspections.some(({ state, replaySafeWhenApplied }) => state === "applied" && !replaySafeWhenApplied)) {
    return "unsafe-replay";
  }
  if (inspections.every(({ state }) => state === "applied")) return "applied";
  return "replayable";
}

async function loadAppliedMigrations(
  sql: ReturnType<typeof postgres>,
  migrationTableSchema: string,
  availableMigrations: string[],
): Promise<string[]> {
  const quotedSchema = quoteIdentifier(migrationTableSchema);
  const qualifiedTable = `${quotedSchema}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;
  const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);

  if (columnNames.has("name")) {
    const rows = await sql.unsafe<{ name: string }[]>(`SELECT name FROM ${qualifiedTable} ORDER BY id`);
    return rows.map((row) => row.name).filter((name): name is string => Boolean(name));
  }

  if (columnNames.has("hash")) {
    const rows = await sql.unsafe<{ hash: string }[]>(`SELECT hash FROM ${qualifiedTable} ORDER BY id`);
    const hashesToMigrationFiles = await mapHashesToMigrationFiles(availableMigrations);
    const appliedFromHashes = rows
      .map((row) => hashesToMigrationFiles.get(row.hash))
      .filter((name): name is string => Boolean(name));

    if (appliedFromHashes.length > 0) {
      // Best-effort: when all hashes resolve, this is authoritative.
      if (appliedFromHashes.length === rows.length) return appliedFromHashes;

      // Partial hash resolution can happen when files have changed; return what we can trust.
      return appliedFromHashes;
    }

    // Fallback only when hashes are unavailable/unresolved.
    if (columnNames.has("created_at")) {
      const journalEntries = await listJournalMigrationEntries();
      if (journalEntries.length > 0) {
        const lastDbRows = await sql.unsafe<{ created_at: string | number | null }[]>(
          `SELECT created_at FROM ${qualifiedTable} ORDER BY created_at DESC LIMIT 1`,
        );
        const lastCreatedAt = Number(lastDbRows[0]?.created_at ?? -1);
        if (Number.isFinite(lastCreatedAt) && lastCreatedAt >= 0) {
          return journalEntries
            .filter((entry) => availableMigrations.includes(entry.fileName))
            .filter((entry) => entry.folderMillis <= lastCreatedAt)
            .map((entry) => entry.fileName)
            .slice(0, rows.length);
        }
      }
    }
  }

  const rows = await sql.unsafe<{ id: number }[]>(`SELECT id FROM ${qualifiedTable} ORDER BY id`);
  const journalMigrationFiles = await listJournalMigrationFiles();
  const appliedFromIds = rows
    .map((row) => journalMigrationFiles[row.id - 1])
    .filter((name): name is string => Boolean(name));
  if (appliedFromIds.length > 0) return appliedFromIds;

  return availableMigrations.slice(0, Math.max(0, rows.length));
}

export type MigrationHistoryReconcileResult = {
  repairedMigrations: string[];
  remainingMigrations: string[];
};

export async function reconcilePendingMigrationHistory(
  url: string,
): Promise<MigrationHistoryReconcileResult> {
  const state = await inspectMigrations(url);
  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    return { repairedMigrations: [], remainingMigrations: [] };
  }

  const sql = createUtilitySql(url);
  const repairedMigrations: string[] = [];

  try {
    const journalEntries = await listJournalMigrationEntries();
    const folderMillisByFile = new Map(journalEntries.map((entry) => [entry.fileName, entry.folderMillis]));
    const migrationTableSchema = await discoverMigrationTableSchema(sql);
    if (!migrationTableSchema) {
      return { repairedMigrations, remainingMigrations: state.pendingMigrations };
    }

    const columnNames = await getMigrationTableColumnNames(sql, migrationTableSchema);
    const qualifiedTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;

    for (const migrationFile of state.pendingMigrations) {
      const migrationContent = await readMigrationFileContent(migrationFile);
      const applicationState = await migrationContentApplicationState(sql, migrationContent);
      if (applicationState !== "applied") break;

      const hash = hashMigrationContent(migrationContent);
      const hashes = migrationContentHashAliases(migrationContent);
      const folderMillis = folderMillisByFile.get(migrationFile) ?? Date.now();
      const existingByHash = columnNames.has("hash")
        ? await sql.unsafe<{ created_at: string | number | null }[]>(
            `SELECT created_at FROM ${qualifiedTable} WHERE hash IN (${hashes.map(quoteLiteral).join(", ")}) ORDER BY created_at DESC LIMIT 1`,
          )
        : [];
      const existingByName = columnNames.has("name")
        ? await sql.unsafe<{ created_at: string | number | null }[]>(
            `SELECT created_at FROM ${qualifiedTable} WHERE name = ${quoteLiteral(migrationFile)} ORDER BY created_at DESC LIMIT 1`,
          )
        : [];
      if (existingByHash.length > 0 || existingByName.length > 0) {
        if (columnNames.has("created_at")) {
          const existingHashCreatedAt = Number(existingByHash[0]?.created_at ?? -1);
          if (existingByHash.length > 0 && Number.isFinite(existingHashCreatedAt) && existingHashCreatedAt < folderMillis) {
            await sql.unsafe(
              `UPDATE ${qualifiedTable} SET created_at = ${quoteLiteral(String(folderMillis))} WHERE hash IN (${hashes.map(quoteLiteral).join(", ")}) AND created_at < ${quoteLiteral(String(folderMillis))}`,
            );
          }

          const existingNameCreatedAt = Number(existingByName[0]?.created_at ?? -1);
          if (existingByName.length > 0 && Number.isFinite(existingNameCreatedAt) && existingNameCreatedAt < folderMillis) {
            await sql.unsafe(
              `UPDATE ${qualifiedTable} SET created_at = ${quoteLiteral(String(folderMillis))} WHERE name = ${quoteLiteral(migrationFile)} AND created_at < ${quoteLiteral(String(folderMillis))}`,
            );
          }
        }

        repairedMigrations.push(migrationFile);
        continue;
      }

      const insertColumns: string[] = [];
      const insertValues: string[] = [];

      if (columnNames.has("hash")) {
        insertColumns.push(quoteIdentifier("hash"));
        insertValues.push(quoteLiteral(hash));
      }
      if (columnNames.has("name")) {
        insertColumns.push(quoteIdentifier("name"));
        insertValues.push(quoteLiteral(migrationFile));
      }
      if (columnNames.has("created_at")) {
        insertColumns.push(quoteIdentifier("created_at"));
        insertValues.push(quoteLiteral(String(folderMillis)));
      }

      if (insertColumns.length === 0) break;

      await sql.unsafe(
        `INSERT INTO ${qualifiedTable} (${insertColumns.join(", ")}) VALUES (${insertValues.join(", ")})`,
      );
      repairedMigrations.push(migrationFile);
    }
  } finally {
    await sql.end();
  }

  const refreshed = await inspectMigrations(url);
  return {
    repairedMigrations,
    remainingMigrations:
      refreshed.status === "needsMigrations" ? refreshed.pendingMigrations : [],
  };
}

async function discoverMigrationTableSchema(sql: ReturnType<typeof postgres>): Promise<string | null> {
  const rows = await sql<{ schemaName: string }[]>`
    SELECT n.nspname AS "schemaName"
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = ${DRIZZLE_MIGRATIONS_TABLE} AND c.relkind = 'r'
  `;

  if (rows.length === 0) return null;

  const drizzleSchema = rows.find(({ schemaName }) => schemaName === "drizzle");
  if (drizzleSchema) return drizzleSchema.schemaName;

  const publicSchema = rows.find(({ schemaName }) => schemaName === "public");
  if (publicSchema) return publicSchema.schemaName;

  return rows[0]?.schemaName ?? null;
}

export async function inspectMigrations(url: string): Promise<MigrationState> {
  const sql = createUtilitySql(url);

  try {
    const availableMigrations = await listMigrationFiles();
    const tableCountResult = await sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
    `;
    const tableCount = tableCountResult[0]?.count ?? 0;

    const migrationTableSchema = await discoverMigrationTableSchema(sql);
    if (!migrationTableSchema) {
      if (tableCount > 0) {
        return {
          status: "needsMigrations",
          tableCount,
          availableMigrations,
          appliedMigrations: [],
          pendingMigrations: availableMigrations,
          journalEntryCount: 0,
          reason: "no-migration-journal-non-empty-db",
        };
      }

      return {
        status: "needsMigrations",
        tableCount,
        availableMigrations,
        appliedMigrations: [],
        pendingMigrations: availableMigrations,
        journalEntryCount: 0,
        reason: "no-migration-journal-empty-db",
      };
    }

    const qualifiedMigrationTable = `${quoteIdentifier(migrationTableSchema)}.${quoteIdentifier(DRIZZLE_MIGRATIONS_TABLE)}`;
    const journalCountRows = await sql.unsafe<{ count: number }[]>(
      `SELECT count(*)::int AS count FROM ${qualifiedMigrationTable}`,
    );
    const journalEntryCount = journalCountRows[0]?.count ?? 0;
    const appliedMigrations = await loadAppliedMigrations(sql, migrationTableSchema, availableMigrations);
    const pendingMigrations = availableMigrations.filter((name) => !appliedMigrations.includes(name));
    if (pendingMigrations.length === 0) {
      return {
        status: "upToDate",
        tableCount,
        availableMigrations,
        appliedMigrations,
        journalEntryCount,
      };
    }

    return {
      status: "needsMigrations",
      tableCount,
      availableMigrations,
      appliedMigrations,
      pendingMigrations,
      journalEntryCount,
      reason: "pending-migrations",
    };
  } finally {
    await sql.end();
  }
}

export async function applyPendingMigrations(url: string): Promise<void> {
  const initialState = await inspectMigrations(url);
  if (initialState.status === "upToDate") return;

  if (initialState.reason === "no-migration-journal-empty-db") {
    // Use the same per-file executor for bootstrap and upgrades: Drizzle wraps
    // the whole journal in one transaction and cannot run committing backfills.
    await applyPendingMigrationsManually(url, initialState.pendingMigrations, false);
    const bootstrappedState = await inspectMigrations(url);
    if (bootstrappedState.status === "upToDate") return;
    throw new Error(
      `Failed to bootstrap migrations: ${bootstrappedState.pendingMigrations.join(", ")}`,
    );
  }

  if (initialState.reason === "no-migration-journal-non-empty-db") {
    throw new Error(
      "Database has tables but no migration journal; automatic migration is unsafe. Initialize migration history manually.",
    );
  }

  let state = await inspectMigrations(url);
  if (state.status === "upToDate") return;

  const repair = await reconcilePendingMigrationHistory(url);
  if (repair.repairedMigrations.length > 0) {
    state = await inspectMigrations(url);
    if (state.status === "upToDate") return;
  }

  if (state.status !== "needsMigrations" || state.reason !== "pending-migrations") {
    throw new Error("Migrations are still pending after migration-history reconciliation; run inspectMigrations for details.");
  }

  await applyPendingMigrationsManually(url, state.pendingMigrations);

  const finalState = await inspectMigrations(url);
  if (finalState.status !== "upToDate") {
    throw new Error(
      `Failed to apply pending migrations: ${finalState.pendingMigrations.join(", ")}`,
    );
  }
}

export type MigrationBootstrapResult =
  | { migrated: true; reason: "migrated-empty-db"; tableCount: 0 }
  | { migrated: false; reason: "already-migrated"; tableCount: number }
  | { migrated: false; reason: "not-empty-no-migration-journal"; tableCount: number };

export async function migratePostgresIfEmpty(url: string): Promise<MigrationBootstrapResult> {
  const sql = createUtilitySql(url);

  try {
    const migrationTableSchema = await discoverMigrationTableSchema(sql);

    const tableCountResult = await sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_type = 'BASE TABLE'
    `;

    const tableCount = tableCountResult[0]?.count ?? 0;

    if (migrationTableSchema) {
      return { migrated: false, reason: "already-migrated", tableCount };
    }

    if (tableCount > 0) {
      return { migrated: false, reason: "not-empty-no-migration-journal", tableCount };
    }

    await applyPendingMigrationsManually(url, await listMigrationFiles(), false);

    return { migrated: true, reason: "migrated-empty-db", tableCount: 0 };
  } finally {
    await sql.end();
  }
}

export async function ensurePostgresDatabase(
  url: string,
  databaseName: string,
): Promise<"created" | "exists"> {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(databaseName)) {
    throw new Error(`Unsafe database name: ${databaseName}`);
  }

  const sql = createUtilitySql(url);
  try {
    const existing = await sql<{ one: number }[]>`
      select 1 as one from pg_database where datname = ${databaseName} limit 1
    `;
    if (existing.length > 0) return "exists";

    await sql.unsafe(`create database "${databaseName}" encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
    return "created";
  } finally {
    await sql.end();
  }
}

export async function resetPostgresDatabase(
  url: string,
  databaseName: string,
): Promise<"reset"> {
  const quotedDatabaseName = quoteIdentifier(databaseName);
  const sql = createUtilitySql(url);
  try {
    await sql`
      select pg_terminate_backend(pid)
      from pg_stat_activity
      where datname = ${databaseName}
        and pid <> pg_backend_pid()
    `;
    await sql.unsafe(`drop database if exists ${quotedDatabaseName}`);
    await sql.unsafe(`create database ${quotedDatabaseName} encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
    return "reset";
  } finally {
    await sql.end();
  }
}

export type Db = ReturnType<typeof createDb>;
