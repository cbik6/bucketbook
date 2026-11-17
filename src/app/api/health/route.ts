import { connection } from "next/server";
import { APP_NAME, APP_VERSION } from "@/lib/app-config";
import { getPool } from "@/server/db/client";
import { appliedMigrationCount } from "@/server/db/migrate";
import { jobsStarted } from "@/server/jobs/boss";
import { startupState } from "@/server/startup";

/**
 * Health check for Docker and reverse proxies. 200 when the database answers
 * and startup (migrations) finished; 503 otherwise. Reveals no secrets.
 */
export async function GET() {
  await connection();
  const startup = startupState();
  let database: "ok" | "error" = "error";
  let migrations = 0;
  try {
    await getPool().query("select 1");
    database = "ok";
    migrations = await appliedMigrationCount(getPool());
  } catch {
    database = "error";
  }

  const healthy = database === "ok" && startup.status === "ready";
  return Response.json(
    {
      status: healthy ? "healthy" : "unhealthy",
      app: APP_NAME,
      version: APP_VERSION,
      startup: startup.status,
      database,
      migrations,
      jobs: jobsStarted() ? "running" : "stopped",
    },
    { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
