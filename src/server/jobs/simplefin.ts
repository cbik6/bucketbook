import type { PgBoss } from "pg-boss";
import { getDb } from "../db/client";
import { runMonthlyRules } from "../buckets/service";
import { syncCron } from "@/lib/bank-sync";
import { allConnectionSchedules, runSync } from "../simplefin/service";
import { getBoss } from "./boss";

/**
 * Scheduled jobs: the SimpleFIN sync and monthly bucket allocations. Each
 * SimpleFIN connection gets its own schedule (keyed by connection id) from its
 * book's setting (how often, from which hour) at the connection's random
 * minute, in the server's TZ. A book set to sync only on request has none.
 */
export const SYNC_QUEUE = "simplefin-sync";
export const MONTHLY_QUEUE = "bucket-monthly";

type SyncJob = { connectionId: string };

export async function registerSimplefinJobs(boss: PgBoss) {
  await boss.createQueue(SYNC_QUEUE, {
    policy: "singleton",
    retryLimit: 1,
    retryDelay: 600,
    expireInSeconds: 900,
  });
  await boss.work<SyncJob>(SYNC_QUEUE, async ([job]) => {
    if (!job) return;
    const result = await runSync(getDb(), job.data.connectionId, { trigger: "schedule" }).catch(
      (err: Error) => ({ status: "error", messages: [err.message] }),
    );
    console.log(`[jobs] simplefin sync ${result.status}`);
  });
  await syncSchedules(boss);

  // Monthly bucket allocations: checked every morning, each rule runs once a month.
  await boss.createQueue(MONTHLY_QUEUE, { policy: "singleton", retryLimit: 1 });
  await boss.work(MONTHLY_QUEUE, async () => {
    const r = await runMonthlyRules(getDb(), null);
    if (r.movedCents) console.log("[jobs] monthly bucket allocations posted");
  });
  await boss.schedule(MONTHLY_QUEUE, "10 1 * * *", null, { tz: process.env.TZ || "UTC" });
}

/** Makes the schedules match the connections and their books: add, move, or remove. */
export async function syncSchedules(boss?: PgBoss | null) {
  const b = boss ?? getBoss();
  if (!b) return;
  const tz = process.env.TZ || "UTC";
  const connections = await allConnectionSchedules(getDb());
  const wanted = new Set<string>();
  for (const c of connections) {
    const cron = syncCron(c.everyHours, c.hour, c.minute);
    if (!cron) continue;
    wanted.add(c.id);
    await b.schedule(
      SYNC_QUEUE,
      cron,
      { connectionId: c.id },
      { key: c.id, tz, singletonKey: c.id },
    );
  }
  for (const s of await b.getSchedules(SYNC_QUEUE)) {
    if (s.key && !wanted.has(s.key)) await b.unschedule(SYNC_QUEUE, s.key);
  }
}
