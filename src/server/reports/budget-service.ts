import { and, eq, inArray } from "drizzle-orm";
import { parseCents } from "@/lib/money";
import { recordAudit } from "../audit/record";
import type { Database } from "../db/client";
import { accounts, budgets } from "../db/schema";
import { UserFacingError } from "../errors";

type Actor = { userId: string };

export const isMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);

export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/**
 * Saves a month's budget. Blank or zero removes the amount. Only income and
 * expense accounts that take postings can have a budget.
 */
export async function saveBudget(
  db: Database,
  actor: Actor,
  bookId: string,
  month: string,
  raw: Record<string, string>,
) {
  if (!isMonth(month)) throw new UserFacingError("Pick a month.");
  const first = `${month}-01`;
  const ids = Object.keys(raw);
  return db.transaction(async (tx) => {
    const rows = ids.length
      ? await tx
          .select({
            id: accounts.id,
            name: accounts.name,
            type: accounts.type,
            allowsPosting: accounts.allowsPosting,
          })
          .from(accounts)
          .where(and(eq(accounts.bookId, bookId), inArray(accounts.id, ids)))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    let changed = 0;
    for (const [accountId, text] of Object.entries(raw)) {
      const acct = byId.get(accountId);
      if (!acct || (acct.type !== "income" && acct.type !== "expense")) continue;
      const t = text.trim();
      let cents = 0;
      if (t) {
        try {
          cents = Math.abs(parseCents(t));
        } catch {
          throw new UserFacingError(`${acct.name}: enter an amount like 250.`, accountId);
        }
      }
      if (cents === 0) {
        await tx
          .delete(budgets)
          .where(and(eq(budgets.accountId, accountId), eq(budgets.month, first)));
      } else {
        await tx
          .insert(budgets)
          .values({ bookId, accountId, month: first, amountCents: cents })
          .onConflictDoUpdate({
            target: [budgets.accountId, budgets.month],
            set: { amountCents: cents, updatedAt: new Date() },
          });
      }
      changed += 1;
    }
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "budget",
      entityId: bookId,
      action: "update",
      after: { month, accounts: changed },
    });
  });
}

/** Copies last month's amounts into this month, replacing what is there. */
export async function copyPreviousMonth(db: Database, actor: Actor, bookId: string, month: string) {
  if (!isMonth(month)) throw new UserFacingError("Pick a month.");
  const prev = `${previousMonth(month)}-01`;
  const first = `${month}-01`;
  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(budgets)
      .where(and(eq(budgets.bookId, bookId), eq(budgets.month, prev)));
    if (rows.length === 0) throw new UserFacingError("Last month has no budget to copy.");
    await tx.delete(budgets).where(and(eq(budgets.bookId, bookId), eq(budgets.month, first)));
    await tx.insert(budgets).values(
      rows.map((r) => ({
        bookId,
        accountId: r.accountId,
        month: first,
        amountCents: r.amountCents,
      })),
    );
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "budget",
      entityId: bookId,
      action: "update",
      after: { month, copiedFrom: previousMonth(month), accounts: rows.length },
    });
    return rows.length;
  });
}
