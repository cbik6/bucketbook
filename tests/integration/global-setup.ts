import { Pool } from "pg";
import { runMigrations } from "../../src/server/db/migrate";
import { TEST_DATABASE_URL, recreateTestDatabase } from "./test-db";

/** Runs once before all integration tests: fresh database, all migrations applied. */
export default async function setup() {
  await recreateTestDatabase();
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  try {
    await runMigrations(pool);
  } finally {
    await pool.end();
  }
}
