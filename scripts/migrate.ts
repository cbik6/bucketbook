/**
 * Run migrations from the command line: `npm run db:migrate`.
 * The app also runs them automatically on startup.
 */
import { Pool } from "pg";
import { runMigrations } from "../src/server/db/migrate";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await runMigrations(pool);
    console.log("Migrations are up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
