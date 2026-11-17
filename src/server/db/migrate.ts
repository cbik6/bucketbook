import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Pool } from "pg";

/** Arbitrary constant so only one process runs migrations at a time. */
const MIGRATION_LOCK_ID = 7_314_002;

export function migrationsFolder(): string {
  return path.join(process.cwd(), "drizzle");
}

/**
 * Applies any pending SQL migrations from ./drizzle. Drizzle records applied
 * migrations in the `drizzle.__drizzle_migrations` table, so this is safe to run
 * on every start. A Postgres advisory lock keeps two app instances from racing.
 */
export async function runMigrations(pool: Pool, folder = migrationsFolder()): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.query("select pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
}

/** Number of applied migrations, for the health check. */
export async function appliedMigrationCount(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `select count(*)::text as count from drizzle.__drizzle_migrations`,
  );
  return Number(result.rows[0]?.count ?? 0);
}
