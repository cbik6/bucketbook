import { sql } from "drizzle-orm";
import { type LearnExample, type Learner, trainLearner } from "@/lib/category-learner";
import type { DbOrTx } from "../db/client";

/** The most recent transactions to learn from; plenty for a household, quick to count. */
const HISTORY_LIMIT = 5000;

/**
 * Trains the category learner on this book's added bank transactions: each
 * one's bank text, and the single account on the other side of its entry as
 * it reads now (so a later fix to an entry teaches the fix). Split entries,
 * transfers and matches to entries you wrote are left out, and so are
 * accounts you can no longer post to.
 */
export async function bookLearner(db: DbOrTx, bookId: string): Promise<Learner> {
  const result = await db.execute<{
    description: string;
    payee: string | null;
    amount_cents: string;
    account_id: string;
    category_id: string;
    entry_payee: string | null;
  }>(sql`
    select t.description, t.payee, t.amount_cents::text, t.account_id,
           min(l.account_id::text) as category_id, min(l.entry_payee) as entry_payee
    from bank_transactions t
    join ledger_lines l on l.entry_id = t.entry_id
    join accounts a on a.id = l.account_id
    where t.book_id = ${bookId}
      and t.status = 'posted'
      and t.post_method = 'approved'
      and l.account_id <> t.account_id
      and not a.is_bucket
      and a.allows_posting
      and a.archived_at is null
    group by t.id
    having count(distinct l.account_id) = 1
    order by max(t.posted_date) desc
    limit ${HISTORY_LIMIT}
  `);
  const examples: LearnExample[] = result.rows.map((r) => ({
    text: bankText(r.description, r.payee),
    amountCents: Number(r.amount_cents),
    bankAccountId: r.account_id,
    categoryId: r.category_id,
    payee: r.entry_payee,
  }));
  return trainLearner(examples);
}

/** What the learner reads: the bank's description, plus its payee when that adds something. */
export function bankText(description: string, payee: string | null) {
  return payee && !description.toLowerCase().includes(payee.toLowerCase())
    ? `${description} ${payee}`
    : description;
}
