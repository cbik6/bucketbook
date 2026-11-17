import { count } from "drizzle-orm";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { books, users } from "../db/schema";
import { getSetting, SETTING_KEYS, setSetting } from "../settings/app-settings";

export type SetupState = {
  hasUser: boolean;
  hasBook: boolean;
  completed: boolean;
};

/**
 * Where the first-run wizard stands. Derived from the data itself, so a wizard
 * interrupted halfway (for example after creating the admin) resumes cleanly.
 */
export async function getSetupState(db: DbOrTx): Promise<SetupState> {
  const [[userCount], [bookCount], completedAt] = await Promise.all([
    db.select({ n: count() }).from(users),
    db.select({ n: count() }).from(books),
    getSetting<string>(db, SETTING_KEYS.setupCompletedAt),
  ]);
  return {
    hasUser: (userCount?.n ?? 0) > 0,
    hasBook: (bookCount?.n ?? 0) > 0,
    completed: Boolean(completedAt),
  };
}

export async function markSetupComplete(db: Database, userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date().toISOString();
    await setSetting(tx, SETTING_KEYS.setupCompletedAt, now);
    await recordAudit(tx, {
      userId,
      entityType: "app",
      entityId: "setup",
      action: "setup",
      after: { setupCompletedAt: now, simplefin: "connect later" },
    });
  });
}
