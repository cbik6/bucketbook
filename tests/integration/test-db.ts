import { Pool } from "pg";

/**
 * Integration tests use their own database next to the dev database, so
 * running tests never touches your dev data. Override with TEST_DATABASE_URL.
 */
export const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ??
  "postgres://bucketbook:bucketbook@localhost:5433/bucketbook";

export const TEST_DB_NAME = "bucketbook_test";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgres://bucketbook:bucketbook@localhost:5433/${TEST_DB_NAME}`;

export async function recreateTestDatabase(): Promise<void> {
  const admin = new Pool({ connectionString: ADMIN_URL, max: 1 });
  try {
    await admin.query(`drop database if exists ${TEST_DB_NAME} with (force)`);
    await admin.query(`create database ${TEST_DB_NAME}`);
  } catch (err) {
    throw new Error(
      `Could not reach the dev Postgres for integration tests. Start it with "npm run db:up".\n${String(err)}`,
    );
  } finally {
    await admin.end();
  }
}

/** Empties every app table (not the migrations table) between tests. */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query(
    `truncate table audit_log, journal_lines, journal_entry_versions, journal_entries, accounts, book_members, books, auth_sessions, auth_accounts,
       auth_verifications, users, app_settings restart identity cascade`,
  );
}
