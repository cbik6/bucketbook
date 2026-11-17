import { eq, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { appSettings } from "../db/schema";

export const SETTING_KEYS = {
  setupCompletedAt: "setup_completed_at",
} as const;

export async function getSetting<T>(db: DbOrTx, key: string): Promise<T | undefined> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  return rows[0]?.value as T | undefined;
}

export async function setSetting(db: DbOrTx, key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: sql`now()` } });
}
