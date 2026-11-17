import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "../env";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either. */
export type DbOrTx = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

type DbState = { pool: Pool; db: Database };

// Kept on globalThis so dev-server hot reloads reuse one pool instead of leaking.
const globalForDb = globalThis as unknown as { __bucketbookDb?: DbState };

export function createDb(connectionString: string, max = 5): DbState {
  const pool = new Pool({ connectionString, max, idleTimeoutMillis: 30_000 });
  pool.on("error", (err) => {
    console.error("[db] idle client error", err.message);
  });
  return { pool, db: drizzle(pool, { schema }) };
}

function state(): DbState {
  if (!globalForDb.__bucketbookDb) {
    const env = getEnv();
    globalForDb.__bucketbookDb = createDb(env.DATABASE_URL, env.DB_POOL_MAX);
  }
  return globalForDb.__bucketbookDb;
}

export function getDb(): Database {
  return state().db;
}

export function getPool(): Pool {
  return state().pool;
}

/** Test helper: point the app at a specific database. */
export function setDbForTests(next: DbState): void {
  globalForDb.__bucketbookDb = next;
}
