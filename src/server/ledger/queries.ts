import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db/client";

/**
 * Read-only ledger queries. They read the `ledger_lines` view (current lines
 * only, with each entry's current date), which is also handy for querying the
 * database by hand.
 */

type Totals = { debitCents: number; creditCents: number };

function toNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isSafeInteger(n)) throw new Error(`Ledger amount out of range: ${String(v)}`);
  return n;
}

/** Debit and credit totals per account, optionally up to and including a date. */
export async function accountTotals(
  db: DbOrTx,
  bookId: string,
  options: { asOf?: string; before?: string } = {},
): Promise<Map<string, Totals>> {
  const filters = [sql`book_id = ${bookId}`];
  if (options.asOf) filters.push(sql`entry_date <= ${options.asOf}`);
  if (options.before) filters.push(sql`entry_date < ${options.before}`);
  const result = await db.execute<{ account_id: string; debits: string; credits: string }>(sql`
    select account_id, sum(debit_cents)::text as debits, sum(credit_cents)::text as credits
    from ledger_lines
    where ${sql.join(filters, sql` and `)}
    group by account_id
  `);
  const map = new Map<string, Totals>();
  for (const r of result.rows) {
    map.set(r.account_id, { debitCents: toNumber(r.debits), creditCents: toNumber(r.credits) });
  }
  return map;
}

/** True if any journal line (current or replaced) uses the account. */
export async function accountHasActivity(db: DbOrTx, accountId: string): Promise<boolean> {
  const result = await db.execute<{ used: boolean }>(
    sql`select exists (select 1 from journal_lines where account_id = ${accountId}) as used`,
  );
  return Boolean(result.rows[0]?.used);
}

/** Net (debits minus credits) of the account's current lines. */
export async function accountNetCents(db: DbOrTx, accountId: string): Promise<number> {
  const result = await db.execute<{ net: string | null }>(
    sql`select coalesce(sum(net_cents), 0)::text as net from ledger_lines where account_id = ${accountId}`,
  );
  return toNumber(result.rows[0]?.net ?? 0);
}

export type RegisterRow = {
  lineId: string;
  entryId: string;
  entryNumber: number;
  entryKind: string;
  entryDate: string;
  entryMemo: string | null;
  lineMemo: string | null;
  accountId: string;
  debitCents: number;
  creditCents: number;
  /** Running net (debits minus credits) including the opening amount. */
  runningNetCents: number;
  /** Names of the other accounts in the same entry. */
  otherAccounts: string[];
};

/**
 * Lines for one or more accounts in date order with a running total. The
 * running total starts from everything before `from`, so it always matches the
 * true balance.
 */
export async function accountRegister(
  db: DbOrTx,
  bookId: string,
  accountIds: string[],
  range: { from?: string; to?: string } = {},
): Promise<{ openingNetCents: number; rows: RegisterRow[] }> {
  if (accountIds.length === 0) return { openingNetCents: 0, rows: [] };
  const ids = sql`array[${sql.join(
    accountIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  )}]`;

  let openingNetCents = 0;
  if (range.from) {
    const opening = await db.execute<{ net: string }>(sql`
      select coalesce(sum(net_cents), 0)::text as net from ledger_lines
      where book_id = ${bookId} and account_id = any(${ids}) and entry_date < ${range.from}
    `);
    openingNetCents = toNumber(opening.rows[0]?.net ?? 0);
  }

  const filters = [sql`l.book_id = ${bookId}`, sql`l.account_id = any(${ids})`];
  if (range.from) filters.push(sql`l.entry_date >= ${range.from}`);
  if (range.to) filters.push(sql`l.entry_date <= ${range.to}`);

  const result = await db.execute<{
    line_id: string;
    entry_id: string;
    entry_number: number;
    entry_kind: string;
    entry_date: string;
    entry_memo: string | null;
    line_memo: string | null;
    account_id: string;
    debit_cents: string;
    credit_cents: string;
    running: string;
    others: string[] | null;
  }>(sql`
    select l.line_id, l.entry_id, l.entry_number, l.entry_kind, l.entry_date::text as entry_date,
           l.entry_memo, l.line_memo, l.account_id,
           l.debit_cents::text as debit_cents, l.credit_cents::text as credit_cents,
           sum(l.net_cents) over (
             order by l.entry_date, l.entry_number, l.line_number
             rows between unbounded preceding and current row
           )::text as running,
           (
             select array_agg(distinct a.name order by a.name)
             from ledger_lines o join accounts a on a.id = o.account_id
             where o.entry_id = l.entry_id and not (o.account_id = any(${ids}))
           ) as others
    from ledger_lines l
    where ${sql.join(filters, sql` and `)}
    order by l.entry_date, l.entry_number, l.line_number
  `);

  return {
    openingNetCents,
    rows: result.rows.map((r) => ({
      lineId: r.line_id,
      entryId: r.entry_id,
      entryNumber: Number(r.entry_number),
      entryKind: r.entry_kind,
      entryDate: r.entry_date,
      entryMemo: r.entry_memo,
      lineMemo: r.line_memo,
      accountId: r.account_id,
      debitCents: toNumber(r.debit_cents),
      creditCents: toNumber(r.credit_cents),
      runningNetCents: openingNetCents + toNumber(r.running),
      otherAccounts: r.others ?? [],
    })),
  };
}

/** Every current line in a date range, for the general ledger. */
export async function linesInRange(
  db: DbOrTx,
  bookId: string,
  range: { from?: string; to?: string },
): Promise<Omit<RegisterRow, "runningNetCents" | "otherAccounts">[]> {
  const filters = [sql`book_id = ${bookId}`];
  if (range.from) filters.push(sql`entry_date >= ${range.from}`);
  if (range.to) filters.push(sql`entry_date <= ${range.to}`);
  const result = await db.execute<{
    line_id: string;
    entry_id: string;
    entry_number: number;
    entry_kind: string;
    entry_date: string;
    entry_memo: string | null;
    line_memo: string | null;
    account_id: string;
    debit_cents: string;
    credit_cents: string;
  }>(sql`
    select line_id, entry_id, entry_number, entry_kind, entry_date::text as entry_date,
           entry_memo, line_memo, account_id,
           debit_cents::text as debit_cents, credit_cents::text as credit_cents
    from ledger_lines
    where ${sql.join(filters, sql` and `)}
    order by entry_date, entry_number, line_number
  `);
  return result.rows.map((r) => ({
    lineId: r.line_id,
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    entryKind: r.entry_kind,
    entryDate: r.entry_date,
    entryMemo: r.entry_memo,
    lineMemo: r.line_memo,
    accountId: r.account_id,
    debitCents: toNumber(r.debit_cents),
    creditCents: toNumber(r.credit_cents),
  }));
}
