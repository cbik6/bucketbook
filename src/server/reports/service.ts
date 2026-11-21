import { and, asc, eq, gte, lte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { type AccountType, NORMAL_BALANCE } from "@/lib/account-types";
import { goalProgress } from "@/lib/buckets";
import type { DbOrTx } from "../db/client";
import { accounts, budgets } from "../db/schema";

/**
 * Reports read the `ledger_lines` view (current lines only). Amounts are
 * returned in each account's natural direction: income and liabilities grow
 * with credits, assets and expenses with debits.
 */

type AccountRow = typeof accounts.$inferSelect;

const natural = (type: string, net: number) =>
  NORMAL_BALANCE[type as AccountType] === "debit" ? net : -net;

export type ReportLine = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  depth: number;
  parentId: string | null;
  /** This account's own amount (not its children). */
  ownCents: number;
  /** Own plus all descendants. */
  totalCents: number;
  /** Own plus descendants per column key, when columns are requested. */
  columns?: Record<string, number>;
  hasChildren: boolean;
};

/** Net (debits minus credits) per account, optionally within dates and split by month. */
async function netByAccount(
  db: DbOrTx,
  bookId: string,
  range: { from?: string; to?: string },
  byMonth = false,
) {
  const filters = [sql`book_id = ${bookId}`];
  if (range.from) filters.push(sql`entry_date >= ${range.from}`);
  if (range.to) filters.push(sql`entry_date <= ${range.to}`);
  const month = byMonth ? sql`to_char(entry_date, 'YYYY-MM')` : sql`''`;
  const result = await db.execute<{ account_id: string; month: string; net: string }>(sql`
    select account_id, ${month} as month, sum(net_cents)::text as net
    from ledger_lines where ${sql.join(filters, sql` and `)}
    group by 1, 2
  `);
  return result.rows.map((r) => ({ accountId: r.account_id, month: r.month, net: Number(r.net) }));
}

/** Builds report lines for the given account types in chart order with rollups. */
function buildLines(
  all: AccountRow[],
  types: AccountType[],
  amounts: Map<string, number>,
  columns?: Map<string, Map<string, number>>,
): ReportLine[] {
  const relevant = all.filter((a) => types.includes(a.type as AccountType));
  const children = new Map<string | null, AccountRow[]>();
  for (const a of relevant) {
    const key = relevant.some((p) => p.id === a.parentAccountId) ? a.parentAccountId : null;
    const list = children.get(key) ?? [];
    list.push(a);
    children.set(key, list);
  }
  for (const list of children.values()) {
    list.sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name));
  }
  const out: ReportLine[] = [];
  const visit = (a: AccountRow, depth: number): { total: number; cols: Map<string, number> } => {
    const own = amounts.get(a.id) ?? 0;
    const line: ReportLine = {
      id: a.id,
      name: a.name,
      code: a.code,
      type: a.type as AccountType,
      depth,
      parentId: a.parentAccountId,
      ownCents: own,
      totalCents: own,
      hasChildren: (children.get(a.id) ?? []).length > 0,
    };
    const cols = new Map(columns?.get(a.id) ?? []);
    out.push(line);
    for (const c of children.get(a.id) ?? []) {
      const sub = visit(c, depth + 1);
      line.totalCents += sub.total;
      for (const [k, v] of sub.cols) cols.set(k, (cols.get(k) ?? 0) + v);
    }
    if (columns) line.columns = Object.fromEntries(cols);
    return { total: line.totalCents, cols };
  };
  for (const type of types) {
    for (const a of (children.get(null) ?? []).filter((x) => x.type === type)) visit(a, 0);
  }
  // Leave out archived accounts with nothing to show.
  return out.filter((l) => {
    const a = relevant.find((x) => x.id === l.id)!;
    return !a.archivedAt || l.totalCents !== 0;
  });
}

export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.slice(0, 7).split("-").map(Number) as [number, number];
  const [ty, tm] = to.slice(0, 7).split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 120) break;
  }
  return out;
}

export async function profitAndLoss(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
  options: { monthly?: boolean } = {},
) {
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const rows = await netByAccount(db, bookId, range, options.monthly);
  const typeOf = new Map(all.map((a) => [a.id, a.type]));
  const amounts = new Map<string, number>();
  const columns = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const type = typeOf.get(r.accountId);
    if (type !== "income" && type !== "expense") continue;
    const v = natural(type, r.net);
    amounts.set(r.accountId, (amounts.get(r.accountId) ?? 0) + v);
    if (options.monthly) {
      const m = columns.get(r.accountId) ?? new Map<string, number>();
      m.set(r.month, (m.get(r.month) ?? 0) + v);
      columns.set(r.accountId, m);
    }
  }
  const lines = buildLines(
    all,
    ["income", "expense"],
    amounts,
    options.monthly ? columns : undefined,
  );
  const months = options.monthly ? monthsBetween(range.from, range.to) : [];
  const top = (type: AccountType) => lines.filter((l) => l.type === type && l.depth === 0);
  const sum = (ls: ReportLine[]) => ls.reduce((n, l) => n + l.totalCents, 0);
  const sumCols = (ls: ReportLine[]) =>
    Object.fromEntries(months.map((m) => [m, ls.reduce((n, l) => n + (l.columns?.[m] ?? 0), 0)]));
  const income = sum(top("income"));
  const expense = sum(top("expense"));
  const incomeCols = sumCols(top("income"));
  const expenseCols = sumCols(top("expense"));
  return {
    lines,
    months,
    incomeCents: income,
    expenseCents: expense,
    netIncomeCents: income - expense,
    incomeColumns: incomeCols,
    expenseColumns: expenseCols,
    netColumns: Object.fromEntries(
      months.map((m) => [m, (incomeCols[m] ?? 0) - (expenseCols[m] ?? 0)]),
    ),
  };
}

/**
 * Balance Sheet as of a date. Income and expense to date are closed into two
 * equity lines: Retained earnings (before this calendar year) and Net income
 * (this year so far). Assets always equal liabilities plus equity.
 */
export async function balanceSheet(db: DbOrTx, bookId: string, asOf: string) {
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const typeOf = new Map(all.map((a) => [a.id, a.type]));
  const yearStart = `${asOf.slice(0, 4)}-01-01`;
  const rows = await netByAccount(db, bookId, { to: asOf });
  const thisYear = await netByAccount(db, bookId, { from: yearStart, to: asOf });
  const amounts = new Map<string, number>();
  let earningsAll = 0;
  for (const r of rows) {
    const type = typeOf.get(r.accountId)!;
    if (type === "income" || type === "expense") earningsAll -= r.net;
    else amounts.set(r.accountId, natural(type, r.net));
  }
  let earningsYear = 0;
  for (const r of thisYear) {
    const type = typeOf.get(r.accountId)!;
    if (type === "income" || type === "expense") earningsYear -= r.net;
  }
  const lines = buildLines(all, ["asset", "liability", "equity"], amounts);
  const total = (type: AccountType) =>
    lines.filter((l) => l.type === type && l.depth === 0).reduce((n, l) => n + l.totalCents, 0);
  const assets = total("asset");
  const liabilities = total("liability");
  const retained = earningsAll - earningsYear;
  const equity = total("equity") + retained + earningsYear;
  return {
    lines,
    assetsCents: assets,
    liabilitiesCents: liabilities,
    equityAccountsCents: total("equity"),
    retainedEarningsCents: retained,
    netIncomeCents: earningsYear,
    equityCents: equity,
    /** Zero in a balanced ledger; shown if it ever isn't. */
    outOfBalanceCents: assets - liabilities - equity,
  };
}

// ---------------------------------------------------------------------------
// Budgets
// ---------------------------------------------------------------------------

export async function budgetForMonth(db: DbOrTx, bookId: string, month: string) {
  const first = `${month}-01`;
  const rows = await db
    .select({ accountId: budgets.accountId, amountCents: budgets.amountCents })
    .from(budgets)
    .where(and(eq(budgets.bookId, bookId), eq(budgets.month, first)));
  return new Map(rows.map((r) => [r.accountId, r.amountCents]));
}

export async function budgetVsActual(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
) {
  const months = monthsBetween(range.from, range.to);
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const budgetRows = await db
    .select()
    .from(budgets)
    .where(
      and(
        eq(budgets.bookId, bookId),
        gte(budgets.month, `${months[0]}-01`),
        lte(budgets.month, `${months.at(-1)}-01`),
      ),
    )
    .orderBy(asc(budgets.month));
  const budgeted = new Map<string, number>();
  for (const b of budgetRows)
    budgeted.set(b.accountId, (budgeted.get(b.accountId) ?? 0) + b.amountCents);
  const pl = await profitAndLoss(db, bookId, range);
  const budgetLines = buildLines(all, ["income", "expense"], budgeted);
  const budgetById = new Map(budgetLines.map((l) => [l.id, l.totalCents]));
  const lines = pl.lines.map((l) => ({
    ...l,
    budgetCents: budgetById.get(l.id) ?? 0,
  }));
  const top = (type: AccountType) => lines.filter((l) => l.type === type && l.depth === 0);
  return {
    lines,
    months,
    income: {
      actual: pl.incomeCents,
      budget: top("income").reduce((n, l) => n + l.budgetCents, 0),
    },
    expense: {
      actual: pl.expenseCents,
      budget: top("expense").reduce((n, l) => n + l.budgetCents, 0),
    },
  };
}

// ---------------------------------------------------------------------------
// Buckets, trends, net worth
// ---------------------------------------------------------------------------

export async function bucketSummary(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
  today: string,
) {
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const parents = all.filter((a) => a.bucketsEnabled);
  const buckets = all.filter((a) => a.isBucket);
  if (buckets.length === 0) return [];
  const result = await db.execute<{
    account_id: string;
    before: string;
    inflow: string;
    outflow: string;
  }>(sql`
    select account_id,
           coalesce(sum(net_cents) filter (where entry_date < ${range.from}), 0)::text as before,
           coalesce(sum(debit_cents) filter (where entry_date between ${range.from} and ${range.to}), 0)::text as inflow,
           coalesce(sum(credit_cents) filter (where entry_date between ${range.from} and ${range.to}), 0)::text as outflow
    from ledger_lines where book_id = ${bookId} and entry_date <= ${range.to}
    group by account_id
  `);
  const by = new Map(result.rows.map((r) => [r.account_id, r]));
  return parents.map((p) => ({
    id: p.id,
    name: p.name,
    buckets: buckets
      .filter((b) => b.parentAccountId === p.id)
      .sort((a, b) => Number(b.isUnassigned) - Number(a.isUnassigned) || a.sortOrder - b.sortOrder)
      .map((b) => {
        const r = by.get(b.id);
        const start = Number(r?.before ?? 0);
        const inflow = Number(r?.inflow ?? 0);
        const outflow = Number(r?.outflow ?? 0);
        const end = start + inflow - outflow;
        return {
          id: b.id,
          name: b.name,
          isUnassigned: b.isUnassigned,
          archived: Boolean(b.archivedAt),
          startCents: start,
          inflowCents: inflow,
          outflowCents: outflow,
          endCents: end,
          goalCents: b.goalCents,
          goalDate: b.goalDate,
          goal: b.goalCents ? goalProgress(end, b.goalCents, b.goalDate, today) : null,
        };
      }),
  }));
}

/** Monthly spending by top-level expense account. */
export async function spendingByMonth(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
) {
  const pl = await profitAndLoss(db, bookId, range, { monthly: true });
  const tops = pl.lines.filter((l) => l.type === "expense" && l.depth === 0 && l.totalCents !== 0);
  return {
    months: pl.months,
    series: tops
      .map((l) => ({
        id: l.id,
        name: l.name,
        totalCents: l.totalCents,
        values: pl.months.map((m) => l.columns?.[m] ?? 0),
      }))
      .sort((a, b) => b.totalCents - a.totalCents),
  };
}

export type PayeeSpending = {
  /** The payee on the Payees list, or null for text that isn't one (or no payee). */
  payeeId: string | null;
  name: string;
  entryCount: number;
  /** Net of expense lines: spending, less refunds. */
  spentCents: number;
  /** Net of income lines. */
  receivedCents: number;
};

/**
 * Spending and income by payee for a range. Entries whose payee isn't on the
 * Payees list group by their payee text; entries with none group as "No payee".
 * Reversed entries and their reversals cancel, so both are left out.
 */
export async function spendingByPayee(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
): Promise<PayeeSpending[]> {
  const result = await db.execute<{
    payee_id: string | null;
    name: string | null;
    entries: number;
    spent: string;
    received: string;
  }>(sql`
    select e.payee_id,
           coalesce(p.name, min(btrim(e.payee))) as name,
           count(distinct e.id)::int as entries,
           coalesce(sum(l.net_cents) filter (where a.type = 'expense'), 0)::text as spent,
           coalesce(-sum(l.net_cents) filter (where a.type = 'income'), 0)::text as received
    from ledger_lines l
    join journal_entries e on e.id = l.entry_id
    join accounts a on a.id = l.account_id
    left join payees p on p.id = e.payee_id
    where l.book_id = ${bookId}
      and l.entry_date between ${range.from}::date and ${range.to}::date
      and a.type in ('expense', 'income')
      and e.kind <> 'reversal'
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)
    group by e.payee_id, p.name,
             case when e.payee_id is null then lower(btrim(coalesce(e.payee, ''))) end
  `);
  return result.rows
    .map((r) => ({
      payeeId: r.payee_id,
      name: r.name || "No payee",
      entryCount: Number(r.entries),
      spentCents: Number(r.spent),
      receivedCents: Number(r.received),
    }))
    .filter((r) => r.spentCents !== 0 || r.receivedCents !== 0)
    .sort(
      (a, b) =>
        b.spentCents - a.spentCents ||
        b.receivedCents - a.receivedCents ||
        a.name.localeCompare(b.name),
    );
}

/** Assets minus liabilities at the end of each month. */
export async function netWorthByMonth(
  db: DbOrTx,
  bookId: string,
  range: { from: string; to: string },
) {
  const months = monthsBetween(range.from, range.to);
  const result = await db.execute<{ month: string; assets: string; liabilities: string }>(sql`
    with months as (
      select to_char(m, 'YYYY-MM') as month,
             (date_trunc('month', m) + interval '1 month - 1 day')::date as month_end
      from generate_series(${`${months[0]}-01`}::date, ${`${months.at(-1)}-01`}::date, interval '1 month') m
    )
    select months.month,
           coalesce(sum(l.net_cents) filter (where a.type = 'asset'), 0)::text as assets,
           coalesce(-sum(l.net_cents) filter (where a.type = 'liability'), 0)::text as liabilities
    from months
    left join ledger_lines l on l.book_id = ${bookId} and l.entry_date <= months.month_end
    left join accounts a on a.id = l.account_id
    group by months.month
    order by months.month
  `);
  return result.rows.map((r) => ({
    month: r.month,
    assetsCents: Number(r.assets),
    liabilitiesCents: Number(r.liabilities),
    netWorthCents: Number(r.assets) - Number(r.liabilities),
  }));
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

const cell = (v: string | number) => {
  const s = String(v);
  // Quote, and neutralize spreadsheet formulas in text cells.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export const centsCsv = (cents: number) => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
};
