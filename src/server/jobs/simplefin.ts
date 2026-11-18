import type { PgBoss } from "pg-boss";
import { getDb } from "../db/client";
import { allConnectionSchedules, runSync } from "../simplefin/service";
import { getBoss } from "./boss";

/**
 * The daily SimpleFIN sync. Each connection gets its own schedule (keyed by
 * connection id) at its chosen hour and a random minute, in the server's TZ.
 */
export const SYNC_QUEUE = "simplefin-sync";

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
}

/** Makes the schedules match the connections: add, move, or remove. */
export async function syncSchedules(boss?: PgBoss | null) {
  const b = boss ?? getBoss();
  if (!b) return;
  const tz = process.env.TZ || "UTC";
  const connections = await allConnectionSchedules(getDb());
  const wanted = new Set(connections.map((c) => c.id));
  for (const c of connections) {
    await b.schedule(
      SYNC_QUEUE,
      `${c.syncMinute} ${c.syncHour} * * *`,
      { connectionId: c.id },
      { key: c.id, tz, singletonKey: c.id },
    );
  }
  for (const s of await b.getSchedules(SYNC_QUEUE)) {
    if (s.key && !wanted.has(s.key)) await b.unschedule(SYNC_QUEUE, s.key);
  }
}
