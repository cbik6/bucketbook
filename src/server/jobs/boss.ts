import { PgBoss } from "pg-boss";

/**
 * pg-boss is a job queue that stores its jobs in Postgres (in its own `pgboss`
 * schema), so no Redis container is needed. Jobs: the daily SimpleFIN sync
 * (see ./simplefin.ts).
 */

type BossState = { boss: PgBoss; started: boolean };
const globalForBoss = globalThis as unknown as { __bucketbookBoss?: BossState };

export async function startJobs(connectionString: string): Promise<PgBoss> {
  if (globalForBoss.__bucketbookBoss?.started) return globalForBoss.__bucketbookBoss.boss;

  // Two connections is plenty for a single-household install and keeps memory low.
  const boss = new PgBoss({ connectionString, max: 2, schema: "pgboss" });
  boss.on("error", (err) =>
    console.error("[jobs] error:", err instanceof Error ? err.message : err),
  );
  globalForBoss.__bucketbookBoss = { boss, started: false };
  await boss.start();
  globalForBoss.__bucketbookBoss.started = true;
  // Imported here so the queue module stays free of app code until it starts.
  const { registerSimplefinJobs } = await import("./simplefin");
  await registerSimplefinJobs(boss);
  console.log("[jobs] queue started");
  return boss;
}

export function getBoss(): PgBoss | null {
  const state = globalForBoss.__bucketbookBoss;
  return state?.started ? state.boss : null;
}

export function jobsStarted(): boolean {
  return globalForBoss.__bucketbookBoss?.started ?? false;
}

export async function stopJobs(): Promise<void> {
  const state = globalForBoss.__bucketbookBoss;
  if (!state?.started) return;
  await state.boss.stop({ graceful: true, timeout: 10_000 });
  state.started = false;
}
