import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { accounts, bankFeeds } from "../db/schema";
import { uuidArray } from "../db/sql";
import { NotFoundError, UserFacingError } from "../errors";

/**
 * Accounts that bank data can land on: asset and liability accounts you can
 * post to (checking, savings, cash, credit cards, loans). System accounts and
 * buckets are left out; an account with buckets takes bank data itself and
 * the bank line goes to one of its buckets (deposits to Unassigned).
 */
export async function bankableAccounts(db: DbOrTx, bookId: string) {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.bookId, bookId),
        inArray(accounts.type, ["asset", "liability"]),
        or(eq(accounts.allowsPosting, true), eq(accounts.bucketsEnabled, true)),
        eq(accounts.isBucket, false),
        isNull(accounts.systemRole),
        isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.type), asc(accounts.sortOrder), asc(accounts.name));
}

export async function requireBankableAccount(db: DbOrTx, bookId: string, accountId: string) {
  const list = await bankableAccounts(db, bookId);
  const found = list.find((a) => a.id === accountId);
  if (found) return found;
  const [any] = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)))
    .catch(() => []);
  if (!any) throw new NotFoundError("That account");
  throw new UserFacingError(
    `${any.name} can't hold bank transactions. Pick a bank, cash, credit card or loan account.`,
    "accountId",
  );
}

export type BankAccountCard = {
  id: string;
  name: string;
  type: string;
  /** The bank's balance from the last sync, as the bank shows it (a card's is what is owed). */
  bankCents: number | null;
  bankAt: Date | null;
  /** The same account's balance in the books, read the same way. */
  bookCents: number;
  reviewCount: number;
};

/**
 * One card per account that gets bank data (a connected feed or any imported
 * row): the bank's balance next to the books' balance, and how many wait in
 * review. Liabilities read as what is owed, the way a statement shows them.
 */
export async function bankAccountCards(db: DbOrTx, bookId: string): Promise<BankAccountCard[]> {
  const list = await bankableAccounts(db, bookId);
  if (list.length === 0) return [];
  const ids = list.map((a) => a.id);
  const [feeds, ledger, queue] = await Promise.all([
    db
      .select({
        accountId: bankFeeds.accountId,
        cents: bankFeeds.balanceCents,
        at: bankFeeds.balanceAt,
      })
      .from(bankFeeds)
      .where(and(eq(bankFeeds.bookId, bookId), eq(bankFeeds.ignored, false))),
    db.execute<{ account_id: string; net: string }>(sql`
      select coalesce(case when a.is_bucket then a.parent_account_id end, l.account_id) as account_id,
             sum(l.net_cents)::text as net
      from ledger_lines l join accounts a on a.id = l.account_id
      where coalesce(case when a.is_bucket then a.parent_account_id end, l.account_id)
            = any(${uuidArray(ids)})
      group by 1
    `),
    db.execute<{ account_id: string; n: number }>(sql`
      select account_id, count(*) filter (where status = 'review')::int as n
      from bank_transactions where book_id = ${bookId} group by account_id
    `),
  ]);
  const net = new Map(ledger.rows.map((r) => [r.account_id, Number(r.net)]));
  const waiting = new Map(queue.rows.map((r) => [r.account_id, Number(r.n)]));
  const bank = new Map<string, { cents: number | null; at: Date | null }>();
  for (const f of feeds) {
    if (!f.accountId) continue;
    const prev = bank.get(f.accountId);
    bank.set(f.accountId, {
      cents: f.cents === null ? (prev?.cents ?? null) : (prev?.cents ?? 0) + f.cents,
      at: !prev?.at || (f.at && f.at > prev.at) ? f.at : prev.at,
    });
  }
  return list
    .filter((a) => bank.has(a.id) || waiting.has(a.id))
    .map((a) => {
      const sign = a.type === "liability" ? -1 : 1;
      const b = bank.get(a.id);
      return {
        id: a.id,
        name: a.name,
        type: a.type,
        // "|| 0" turns a flipped zero (-0) back into 0, so it never shows as -$0.00.
        bankCents: b?.cents == null ? null : sign * b.cents || 0,
        bankAt: b?.at ?? null,
        bookCents: sign * (net.get(a.id) ?? 0) || 0,
        reviewCount: waiting.get(a.id) ?? 0,
      };
    });
}
