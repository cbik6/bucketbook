import { count, desc, eq } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { auditLog, users } from "../db/schema";

export async function listBookActivity(
  db: DbOrTx,
  bookId: string,
  options: { limit?: number; offset?: number } = {},
) {
  const limit = Math.min(options.limit ?? 50, 200);
  const rows = await db
    .select({
      id: auditLog.id,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      action: auditLog.action,
      beforeData: auditLog.beforeData,
      afterData: auditLog.afterData,
      createdAt: auditLog.createdAt,
      userName: users.name,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(eq(auditLog.bookId, bookId))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
    .offset(Math.max(options.offset ?? 0, 0));
  const [total] = await db.select({ n: count() }).from(auditLog).where(eq(auditLog.bookId, bookId));
  return { rows, total: total?.n ?? 0 };
}
