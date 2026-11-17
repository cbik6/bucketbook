import { getPool } from "./db/client";
import { runMigrations } from "./db/migrate";
import { EnvError, getEnv } from "./env";
import { startJobs, stopJobs } from "./jobs/boss";

type StartupState = { status: "starting" | "ready" | "failed"; error?: string };
const globalForStartup = globalThis as unknown as { __bucketbookStartup?: StartupState };

export function startupState(): StartupState {
  return globalForStartup.__bucketbookStartup ?? { status: "starting" };
}

/**
 * Runs once when the server starts (from instrumentation.ts), before it serves
 * requests: check configuration, apply database migrations, start the job queue.
 * Any failure stops the process with a clear message, so Docker shows it and
 * restarts the container instead of serving a half-working app.
 */
export async function startServer(): Promise<void> {
  globalForStartup.__bucketbookStartup = { status: "starting" };
  try {
    const env = getEnv();
    console.log("[startup] configuration ok");

    await runMigrations(getPool());
    console.log("[startup] database migrations up to date");

    if (env.JOBS_ENABLED) await startJobs(env.DATABASE_URL);

    globalForStartup.__bucketbookStartup = { status: "ready" };
    console.log("[startup] ready");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    globalForStartup.__bucketbookStartup = { status: "failed", error: message };
    if (err instanceof EnvError) {
      console.error(`\n[startup] ${message}\n`);
    } else {
      console.error("[startup] failed:", err);
    }
    process.exit(1);
  }

  const shutdown = async () => {
    await stopJobs().catch(() => {});
    await getPool()
      .end()
      .catch(() => {});
    process.exit(0);
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
