import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type AccountType, isAccountType } from "@/lib/account-types";
import {
  type DraftLine,
  type ParsedLine,
  formatEntryNumber,
  parseDraftLines,
} from "@/lib/ledger-math";
import { formatCents, parseCents } from "@/lib/money";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import {
  type EntryKind,
  accounts,
  bankTransactions,
  books,
  journalEntries,
  journalEntryVersions,
  journalLines,
  openingBalances,
  users,
} from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";
import { assertReconciledChangeConfirmed } from "../reconcile/service";

type Actor = { userId: string };

export const MAX_LINES = 500;

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That isn't a real date.");

const draftLine = z.object({
  accountId: z.string().default(""),
  debit: z.string().default(""),
  credit: z.string().default(""),
  memo: z.string().max(500, "Keep line memos under 500 characters.").default(""),
});

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((v) => v || null)
    .nullable()
    .default(null);

const entryInputSchema = z.object({
  entryDate: isoDate,
  payee: optionalText(200, "payee"),
  memo: z
    .string()
    .trim()
    .max(500, "Keep the memo under 500 characters.")
    .transform((v) => v || null)
    .nullable()
    .default(null),
  lines: z.array(draftLine).max(MAX_LINES, `An entry can have at most ${MAX_LINES} lines.`),
  /** Set when you've seen the warning that this entry is in a finished reconciliation. */
  confirmReconciled: z.boolean().default(false),
});

export type EntryInput = {
  entryDate: string;
  payee?: string | null;
  memo: string | null;
  lines: DraftLine[];
};

function parseEntryInput(raw: unknown): z.infer<typeof entryInputSchema> {
  const result = entryInputSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  return result.data;
}

/** Exact text for a cents amount (no float math), for re-parsing. */
const centsText = (cents: number) => formatCents(cents, { showSymbol: false });

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" }).format(
    new Date(`${iso}T00:00:00Z`),
  );

export async function loadBookForPosting(tx: DbOrTx, bookId: string) {
  // Locking the book row serializes entry numbering within a book.
  const result = await tx.execute<{ id: string; start_date: string; archived_at: Date | null }>(
    sql`select id, start_date::text as start_date, archived_at from books where id = ${bookId} for update`,
  );
  const book = result.rows[0];
  if (!book) throw new NotFoundError("That book");
  if (book.archived_at)
    throw new UserFacingError("This book is archived. Restore it to make changes.");
  return { id: book.id, startDate: book.start_date };
}

async function nextEntryNumber(tx: DbOrTx, bookId: string): Promise<number> {
  const result = await tx.execute<{ next: number }>(
    sql`select coalesce(max(entry_number), 0) + 1 as next from journal_entries where book_id = ${bookId}`,
  );
  return Number(result.rows[0]!.next);
}

/**
 * Checks the lines balance and every account can take postings. Returns clean
 * lines. When the book keeps parent accounts as headings, a parent is refused
 * unless it is in `allowParents` (opening balances, or a line an edited entry
 * already had).
 */
export async function validateLines(
  tx: DbOrTx,
  bookId: string,
  lines: DraftLine[],
  options: { allowParents?: "all" | string[] } = {},
): Promise<ParsedLine[]> {
  const { parsed, problems, debitTotal, creditTotal } = parseDraftLines(lines);
  if (problems.length > 0) {
    const p = problems[0]!;
    throw new UserFacingError(`Line ${p.index + 1}: ${p.message}`, "lines");
  }
  if (parsed.length < 2) {
    throw new UserFacingError("An entry needs at least two lines.", "lines");
  }
  if (debitTotal !== creditTotal) {
    throw new UserFacingError(
      `Debits (${formatCents(debitTotal)}) and credits (${formatCents(creditTotal)}) must be equal. They differ by ${formatCents(Math.abs(debitTotal - creditTotal))}.`,
      "lines",
    );
  }
  if (debitTotal === 0) throw new UserFacingError("Enter amounts on the lines.", "lines");

  const ids = [...new Set(parsed.map((l) => l.accountId))];
  const rows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      allowsPosting: accounts.allowsPosting,
      archivedAt: accounts.archivedAt,
    })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), inArray(accounts.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  parsed.forEach((l, i) => {
    const a = byId.get(l.accountId);
    if (!a) throw new UserFacingError(`Line ${i + 1}: that account isn't in this book.`, "lines");
    if (a.archivedAt) {
      throw new UserFacingError(`Line ${i + 1}: ${a.name} is archived. Restore it first.`, "lines");
    }
    if (!a.allowsPosting) {
      throw new UserFacingError(
        `Line ${i + 1}: ${a.name} holds buckets, so post to one of its buckets instead.`,
        "lines",
      );
    }
  });
  if (options.allowParents !== "all") {
    const blocked = await parentsBlocked(tx, bookId, ids);
    const allowed = new Set(options.allowParents ?? []);
    parsed.forEach((l, i) => {
      if (blocked.has(l.accountId) && !allowed.has(l.accountId)) {
        throw new UserFacingError(
          `Line ${i + 1}: ${byId.get(l.accountId)!.name} is a parent account. Choose one of its sub-accounts.`,
          "lines",
        );
      }
    });
  }
  return parsed;
}

/**
 * Of these accounts, the parents that can't take postings: only when the book
 * keeps parent accounts as headings, and only parents of real sub-accounts
 * (buckets don't count; their parent is handled by the bucket rules).
 */
export async function parentsBlocked(
  tx: DbOrTx,
  bookId: string,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const [book] = await tx
    .select({ postToParents: books.postToParents })
    .from(books)
    .where(eq(books.id, bookId));
  if (!book || book.postToParents) return new Set();
  const rows = await tx
    .selectDistinct({ id: accounts.parentAccountId })
    .from(accounts)
    .where(
      and(
        eq(accounts.bookId, bookId),
        inArray(accounts.parentAccountId, ids),
        eq(accounts.isBucket, false),
      ),
    );
  return new Set(rows.map((r) => r.id).filter((id): id is string => Boolean(id)));
}

async function insertVersion(
  tx: DbOrTx,
  args: {
    actor: Actor;
    bookId: string;
    entryId: string;
    version: number;
    entryDate: string;
    payee: string | null;
    memo: string | null;
    changeNote: string;
    lines: ParsedLine[];
  },
) {
  await tx.insert(journalEntryVersions).values({
    entryId: args.entryId,
    version: args.version,
    entryDate: args.entryDate,
    payee: args.payee,
    memo: args.memo,
    changeNote: args.changeNote,
    createdBy: args.actor.userId,
  });
  await tx.insert(journalLines).values(
    args.lines.map((l, i) => ({
      bookId: args.bookId,
      entryId: args.entryId,
      version: args.version,
      lineNumber: i + 1,
      accountId: l.accountId,
      debitCents: l.debitCents,
      creditCents: l.creditCents,
      memo: l.memo,
    })),
  );
}

export async function createEntry(
  tx: DbOrTx,
  args: {
    actor: Actor;
    bookId: string;
    kind: EntryKind;
    entryDate: string;
    payee?: string | null;
    memo: string | null;
    lines: ParsedLine[];
    reversesEntryId?: string;
    transferGroupId?: string;
    changeNote: string;
    /** Set by keepOpeningBalances itself, which already brings everything in line. */
    skipOpeningSync?: boolean;
  },
) {
  const entryNumber = await nextEntryNumber(tx, args.bookId);
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      bookId: args.bookId,
      entryNumber,
      kind: args.kind,
      entryDate: args.entryDate,
      payee: args.payee ?? null,
      memo: args.memo,
      reversesEntryId: args.reversesEntryId ?? null,
      transferGroupId: args.transferGroupId ?? null,
      createdBy: args.actor.userId,
    })
    .returning();
  await insertVersion(tx, {
    actor: args.actor,
    bookId: args.bookId,
    entryId: entry!.id,
    version: 1,
    entryDate: args.entryDate,
    payee: args.payee ?? null,
    memo: args.memo,
    changeNote: args.changeNote,
    lines: args.lines,
  });
  await recordAudit(tx, {
    bookId: args.bookId,
    userId: args.actor.userId,
    entityType: "journal_entry",
    entityId: entry!.id,
    action: "create",
    after: { ...entry, lines: args.lines },
  });
  if (
    args.kind !== "opening_balance" &&
    !args.skipOpeningSync &&
    (await openingMayChange(tx, args.bookId, args.entryDate))
  ) {
    await keepOpeningBalances(tx, args.actor, args.bookId);
  }
  return entry!;
}

/**
 * Whether a change dated `date` can move an opening amount: it lands before some
 * account's anchor date, or before an opening entry. Most activity is newer than
 * both, and then there's nothing to recompute.
 */
async function openingMayChange(tx: DbOrTx, bookId: string, date: string): Promise<boolean> {
  const result = await tx.execute<{ hit: boolean }>(sql`
    select exists (select 1 from opening_balances where book_id = ${bookId} and as_of > ${date}::date)
        or exists (select 1 from journal_entries where book_id = ${bookId}
                   and kind = 'opening_balance' and entry_date > ${date}::date) as hit
  `);
  return Boolean(result.rows[0]?.hit);
}

/** Posts a new manual journal entry. */
export async function postEntry(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const input = parseEntryInput(raw);
  return db.transaction(async (tx) => {
    await loadBookForPosting(tx, bookId);
    const lines = await validateLines(tx, bookId, input.lines);
    return createEntry(tx, {
      actor,
      bookId,
      kind: "manual",
      entryDate: input.entryDate,
      payee: input.payee,
      memo: input.memo,
      lines,
      changeNote: "Created",
    });
  });
}

async function loadEntryForChange(tx: DbOrTx, bookId: string, entryId: string) {
  if (!z.uuid().safeParse(entryId).success) throw new NotFoundError("That journal entry");
  const result = await tx.execute<{ id: string }>(
    sql`select id from journal_entries where id = ${entryId} and book_id = ${bookId} for update`,
  );
  if (!result.rows[0]) throw new NotFoundError("That journal entry");
  const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId));
  const [reversal] = await tx
    .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, entryId));
  return { entry: entry!, reversedBy: reversal ?? null };
}

async function currentLines(tx: DbOrTx, entryId: string, version: number) {
  return tx
    .select()
    .from(journalLines)
    .where(
      and(
        eq(journalLines.entryId, entryId),
        eq(journalLines.version, version),
        eq(journalLines.isCurrent, true),
      ),
    )
    .orderBy(journalLines.lineNumber);
}

/**
 * Edits an entry by saving a new version. The old lines stay in the database,
 * marked as replaced, and the audit log records before and after.
 */
export async function editEntry(
  db: Database,
  actor: Actor,
  bookId: string,
  entryId: string,
  raw: unknown,
  options: { allowKinds?: EntryKind[] } = {},
) {
  const input = parseEntryInput(raw);
  const allowKinds = options.allowKinds ?? ["manual", "bank", "transfer"];
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    const { entry, reversedBy } = await loadEntryForChange(tx, bookId, entryId);
    if (entry.kind === "reversal") {
      throw new UserFacingError(
        "A reversal can't be edited. Edit or re-enter the original entry instead.",
      );
    }
    if (!allowKinds.includes(entry.kind as EntryKind)) {
      throw new UserFacingError("Change opening balances from the Opening balances screen.");
    }
    if (reversedBy) {
      throw new UserFacingError(
        `This entry was reversed by ${formatEntryNumber(reversedBy.entryNumber)}, so it can't be edited. Post a new entry instead.`,
      );
    }
    await assertReconciledChangeConfirmed(tx, entryId, input.confirmReconciled);
    return editEntryInTx(tx, actor, book, entryId, input);
  });
}

/** Posts a mirror-image entry that cancels the original as of `entryDate`. */
export async function reverseEntry(
  db: Database,
  actor: Actor,
  bookId: string,
  entryId: string,
  raw: { entryDate?: string; memo?: string; confirmReconciled?: boolean },
) {
  const parsed = z
    .object({
      entryDate: isoDate,
      memo: z.string().trim().max(500).optional(),
      confirmReconciled: z.boolean().default(false),
    })
    .safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]!.message, "entryDate");
  return db.transaction(async (tx) => {
    await loadBookForPosting(tx, bookId);
    const { entry, reversedBy } = await loadEntryForChange(tx, bookId, entryId);
    if (entry.kind === "reversal") {
      throw new UserFacingError("A reversal can't be reversed. Post a new entry instead.");
    }
    if (entry.kind === "opening_balance") {
      throw new UserFacingError(
        "Bucketbook keeps opening balance entries in line with the Opening balances screen. Change or clear the amounts there instead.",
      );
    }
    if (reversedBy) {
      throw new UserFacingError(
        `This entry was already reversed by ${formatEntryNumber(reversedBy.entryNumber)}.`,
      );
    }
    await assertReconciledChangeConfirmed(tx, entryId, parsed.data.confirmReconciled);
    const date = parsed.data.entryDate;
    if (date < entry.entryDate) {
      throw new UserFacingError(
        `A reversal can't be dated before the original entry (${formatDate(entry.entryDate)}).`,
        "entryDate",
      );
    }
    const original = await currentLines(tx, entryId, entry.currentVersion);
    const lines: ParsedLine[] = original.map((l) => ({
      accountId: l.accountId,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
      memo: l.memo,
    }));
    const memo =
      parsed.data.memo ||
      `Reverses ${formatEntryNumber(entry.entryNumber)}${entry.memo ? `: ${entry.memo}` : ""}`;
    const reversal = await createEntry(tx, {
      actor,
      bookId,
      kind: "reversal",
      entryDate: date,
      payee: entry.payee,
      memo: memo.slice(0, 500),
      lines,
      reversesEntryId: entryId,
      changeNote: "Created as a reversal",
    });
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "journal_entry",
      entityId: entryId,
      action: "reverse",
      after: { reversedByEntryId: reversal.id, reversalDate: date },
    });
    // Bank transactions this entry recorded are no longer recorded: back to review.
    const returned = await tx
      .update(bankTransactions)
      .set({ status: "review", entryId: null, postMethod: null })
      .where(and(eq(bankTransactions.bookId, bookId), eq(bankTransactions.entryId, entryId)))
      .returning({ id: bankTransactions.id });
    return Object.assign(reversal, { returnedToReview: returned.length });
  });
}

// ---------------------------------------------------------------------------
// Opening balances
//
// Each account can have an anchored balance (opening_balances): on `asOf`, before
// that day's activity, it held `balanceCents`. The app keeps the opening_balance
// entries matching the anchors, so transactions can be added for any date:
//
//   opening amount = anchored balance - activity dated before asOf
//   opening date   = asOf, or the day before the account's first activity when
//                    that is earlier (so the opening comes first in registers)
//
// Accounts sharing an opening date share one entry, offset to Opening Balance
// Equity. Whenever anything else is posted, edited or reversed, the entries are
// brought back in line (keepOpeningBalances), so the balance on each anchor date
// never moves. An account with buckets counts its buckets' activity, and its
// opening amount sits in its Unassigned bucket.
// ---------------------------------------------------------------------------

export type OpeningAccount = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  subtype: string;
  parentAccountId: string | null;
  sortOrder: number;
  archivedAt: Date | null;
  /** The anchored balance in the account's natural direction (0 when none). */
  naturalCents: number;
  /** Whether the account has an anchored balance at all. */
  anchored: boolean;
  /** The anchor date, or null. */
  asOf: string | null;
  /** The opening amount actually posted (natural direction), after earlier activity. */
  openingCents: number;
  /** The date that amount is posted on, or null when nothing is posted. */
  openingDate: string | null;
};

type AnchorPlan = {
  accountId: string;
  type: AccountType;
  asOf: string;
  balanceCents: number;
  /** Where the opening line posts: the account, or its Unassigned bucket. */
  targetId: string | null;
  /** Net (debit positive) to post, and on which date. */
  net: number;
  date: string;
};

/**
 * Real activity: not opening entries, and not the reversals that cancel them
 * (both are the app's own bookkeeping of the anchors).
 */
const notOpening = sql`l.entry_kind <> 'opening_balance' and not exists (
  select 1 from journal_entries rv join journal_entries og on og.id = rv.reverses_entry_id
  where rv.id = l.entry_id and og.kind = 'opening_balance')`;

/** Each anchor with what its opening line has to be right now. */
async function planAnchors(tx: DbOrTx, bookId: string): Promise<AnchorPlan[]> {
  const result = await tx.execute<{
    account_id: string;
    type: string;
    allows_posting: boolean;
    as_of: string;
    balance_cents: string;
    unassigned_id: string | null;
    history: string;
    earliest: string | null;
  }>(sql`
    select o.account_id, a.type, a.allows_posting, o.as_of::text as as_of,
           o.balance_cents::text as balance_cents,
           (select u.id from accounts u
             where u.parent_account_id = o.account_id and u.is_unassigned limit 1) as unassigned_id,
           coalesce((select sum(l.net_cents) from ledger_lines l join accounts x on x.id = l.account_id
             where (x.id = o.account_id or (x.parent_account_id = o.account_id and x.is_bucket))
               and ${notOpening} and l.entry_date < o.as_of), 0)::text as history,
           (select min(l.entry_date)::text from ledger_lines l join accounts x on x.id = l.account_id
             where (x.id = o.account_id or (x.parent_account_id = o.account_id and x.is_bucket))
               and ${notOpening}) as earliest
    from opening_balances o
    join accounts a on a.id = o.account_id
    where o.book_id = ${bookId}
  `);
  return result.rows.map((r) => {
    const type = r.type as AccountType;
    const sign = type === "asset" ? 1 : -1;
    const naturalHistory = sign * Number(r.history);
    const openingNatural = Number(r.balance_cents) - naturalHistory;
    return {
      accountId: r.account_id,
      type,
      asOf: r.as_of,
      balanceCents: Number(r.balance_cents),
      targetId: r.allows_posting ? r.account_id : r.unassigned_id,
      net: sign * openingNatural,
      date: r.earliest && r.earliest < r.as_of ? dayBefore(r.earliest) : r.as_of,
    };
  });
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

type LiveOpening = {
  id: string;
  entryNumber: number;
  entryDate: string;
  currentVersion: number;
  memo: string | null;
  lines: { accountId: string; net: number }[];
};

/** The opening entries that count: not reversed, with their current lines. */
async function liveOpeningEntries(tx: DbOrTx, bookId: string): Promise<LiveOpening[]> {
  const entries = await tx.execute<{
    id: string;
    entry_number: number;
    entry_date: string;
    current_version: number;
    memo: string | null;
  }>(sql`
    select e.id, e.entry_number, e.entry_date::text as entry_date, e.current_version, e.memo
    from journal_entries e
    where e.book_id = ${bookId} and e.kind = 'opening_balance'
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)
    order by e.entry_date, e.entry_number
  `);
  const out: LiveOpening[] = [];
  for (const e of entries.rows) {
    const lines = await currentLines(tx, e.id, e.current_version);
    out.push({
      id: e.id,
      entryNumber: e.entry_number,
      entryDate: e.entry_date,
      currentVersion: e.current_version,
      memo: e.memo,
      lines: lines.map((l) => ({ accountId: l.accountId, net: l.debitCents - l.creditCents })),
    });
  }
  return out;
}

function toParsedLines(nets: Map<string, number>, offsetAccountId: string): ParsedLine[] {
  const lines: ParsedLine[] = [];
  let total = 0;
  for (const [accountId, net] of nets) {
    if (net === 0) continue;
    total += net;
    lines.push({
      accountId,
      debitCents: net > 0 ? net : 0,
      creditCents: net < 0 ? -net : 0,
      memo: null,
    });
  }
  if (lines.length && total !== 0) {
    lines.push({
      accountId: offsetAccountId,
      debitCents: total < 0 ? -total : 0,
      creditCents: total > 0 ? total : 0,
      memo: null,
    });
  }
  return lines;
}

function sameNets(a: Map<string, number>, b: Map<string, number>) {
  const keys = new Set([...a.keys(), ...b.keys()]);
  for (const k of keys) if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) return false;
  return true;
}

/** Writes a new version of an opening entry from lines the app computed itself. */
async function reviseOpeningEntry(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  entry: LiveOpening,
  date: string,
  lines: ParsedLine[],
  changeNote: string,
) {
  const version = entry.currentVersion + 1;
  const beforeLines = await currentLines(tx, entry.id, entry.currentVersion);
  await tx
    .update(journalLines)
    .set({ isCurrent: false })
    .where(and(eq(journalLines.entryId, entry.id), eq(journalLines.isCurrent, true)));
  await insertVersion(tx, {
    actor,
    bookId,
    entryId: entry.id,
    version,
    entryDate: date,
    payee: null,
    memo: entry.memo,
    changeNote,
    lines,
  });
  const [after] = await tx
    .update(journalEntries)
    .set({ currentVersion: version, entryDate: date })
    .where(eq(journalEntries.id, entry.id))
    .returning();
  await recordAudit(tx, {
    bookId,
    userId: actor.userId,
    entityType: "journal_entry",
    entityId: entry.id,
    action: "update",
    before: { entryDate: entry.entryDate, lines: beforeLines },
    after: { ...after, lines },
  });
}

/**
 * Brings the opening_balance entries in line with the anchors. Runs inside the
 * transaction of every change to the ledger, so the balance on each anchor date
 * stays what was entered (or what the bank said) whatever else is added.
 */
export async function keepOpeningBalances(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  /** Accounts whose opening balance was just removed: their lines go too. */
  released: string[] = [],
) {
  const plans = await planAnchors(tx, bookId);
  const live = await liveOpeningEntries(tx, bookId);
  if (plans.length === 0 && live.length === 0) return;
  const anchored = new Set([...plans.map((p) => p.accountId), ...released]);

  // What each date's entry should hold: account -> net.
  const wanted = new Map<string, Map<string, number>>();
  const add = (date: string, accountId: string, net: number) => {
    if (net === 0) return;
    const m = wanted.get(date) ?? new Map<string, number>();
    m.set(accountId, (m.get(accountId) ?? 0) + net);
    wanted.set(date, m);
  };
  for (const p of plans) {
    if (p.targetId) add(p.date, p.targetId, p.net);
  }

  const offsetId = await openingEquityId(tx, bookId);
  // Lines on accounts without an anchor (and their buckets) aren't ours to change.
  const bucketParent = await bucketParents(tx, bookId);
  for (const e of live) {
    for (const l of e.lines) {
      if (l.accountId === offsetId) continue;
      const owner = bucketParent.get(l.accountId) ?? l.accountId;
      if (!anchored.has(owner) && !anchored.has(l.accountId)) add(e.entryDate, l.accountId, l.net);
    }
  }

  const used = new Set<string>();
  for (const e of live) {
    const want = used.has(e.entryDate) ? undefined : wanted.get(e.entryDate);
    const have = new Map<string, number>();
    for (const l of e.lines) {
      if (l.accountId !== offsetId) have.set(l.accountId, (have.get(l.accountId) ?? 0) + l.net);
    }
    if (want && want.size > 0) {
      used.add(e.entryDate);
      if (!sameNets(want, have)) {
        await reviseOpeningEntry(
          tx,
          actor,
          bookId,
          e,
          e.entryDate,
          toParsedLines(want, offsetId),
          "Opening amounts updated to keep each account's balance on its opening date",
        );
      }
      continue;
    }
    // Nothing belongs on this date any more: cancel the entry. A line on an account
    // that now holds buckets is cancelled in its Unassigned bucket instead.
    const lines: ParsedLine[] = [];
    for (const l of e.lines) {
      const target = await postingTargetFor(tx, l.accountId);
      lines.push({
        accountId: target,
        debitCents: l.net < 0 ? -l.net : 0,
        creditCents: l.net > 0 ? l.net : 0,
        memo: null,
      });
    }
    await createEntry(tx, {
      actor,
      bookId,
      kind: "reversal",
      entryDate: e.entryDate,
      memo: `Reverses ${formatEntryNumber(e.entryNumber)}: opening amounts moved to an earlier date`,
      lines,
      reversesEntryId: e.id,
      changeNote: "Opening amounts moved to an earlier date",
      skipOpeningSync: true,
    });
  }

  for (const [date, nets] of wanted) {
    if (used.has(date) || nets.size === 0) continue;
    const lines = toParsedLines(nets, offsetId);
    if (lines.length < 2) continue;
    await createEntry(tx, {
      actor,
      bookId,
      kind: "opening_balance",
      entryDate: date,
      memo: "Opening balances",
      lines,
      changeNote: "Created",
      skipOpeningSync: true,
    });
  }
}

async function openingEquityId(tx: DbOrTx, bookId: string): Promise<string> {
  const [obe] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.systemRole, "opening_balance_equity")));
  if (!obe) throw new UserFacingError("This book is missing its Opening Balance Equity account.");
  return obe.id;
}

/** bucket id -> the account that holds it. */
async function bucketParents(tx: DbOrTx, bookId: string): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: accounts.id, parent: accounts.parentAccountId })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.isBucket, true)));
  return new Map(
    rows
      .filter((r): r is { id: string; parent: string } => Boolean(r.parent))
      .map((r) => [r.id, r.parent]),
  );
}

/** The account itself, or its Unassigned bucket when it now holds buckets. */
async function postingTargetFor(tx: DbOrTx, accountId: string): Promise<string> {
  const [a] = await tx
    .select({ allowsPosting: accounts.allowsPosting })
    .from(accounts)
    .where(eq(accounts.id, accountId));
  if (!a || a.allowsPosting) return accountId;
  const [u] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.parentAccountId, accountId), eq(accounts.isUnassigned, true)));
  return u?.id ?? accountId;
}

/** Balance sheet accounts that can hold an opening balance, with their anchors. */
export async function openingBalanceState(db: DbOrTx, bookId: string) {
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const anchors = await db.select().from(openingBalances).where(eq(openingBalances.bookId, bookId));
  const anchorBy = new Map(anchors.map((a) => [a.accountId, a]));
  const plans = new Map((await planAnchors(db, bookId)).map((p) => [p.accountId, p]));
  const live = await liveOpeningEntries(db, bookId);
  const obe = all.find((a) => a.systemRole === "opening_balance_equity");
  const eligible: OpeningAccount[] = all
    .filter(
      (a) =>
        ["asset", "liability", "equity"].includes(a.type) &&
        !a.systemRole &&
        !a.isBucket &&
        (a.allowsPosting || a.bucketsEnabled) &&
        (!a.archivedAt || anchorBy.has(a.id)),
    )
    .map((a) => {
      const type = a.type as AccountType;
      const anchor = anchorBy.get(a.id);
      const plan = plans.get(a.id);
      const sign = type === "asset" ? 1 : -1;
      return {
        id: a.id,
        name: a.name,
        code: a.code,
        type,
        subtype: a.subtype,
        parentAccountId: a.parentAccountId,
        sortOrder: a.sortOrder,
        archivedAt: a.archivedAt,
        naturalCents: anchor?.balanceCents ?? 0,
        anchored: Boolean(anchor),
        asOf: anchor?.asOf ?? null,
        openingCents: plan ? sign * plan.net : 0,
        openingDate: plan && plan.net !== 0 ? plan.date : null,
      };
    });
  return {
    entries: live.map((e) => ({ id: e.id, entryNumber: e.entryNumber, entryDate: e.entryDate })),
    accounts: eligible,
    openingBalanceEquityId: obe?.id ?? null,
  };
}

const anchorDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date of this balance.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That isn't a real date.");

/**
 * Saves anchored balances: for each account, what it held (statement-style,
 * positive for what a card owes) on a date. A blank amount removes the account's
 * opening balance. `asOf` is one date for every account or a date per account;
 * without one, an account keeps its anchor's date, or uses the book's start date.
 * The opening entries are then brought in line.
 */
export async function saveOpeningBalances(
  db: Database,
  actor: Actor,
  bookId: string,
  rawAmounts: Record<string, string>,
  asOf?: string | Record<string, string>,
) {
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    const state = await openingBalanceState(tx, bookId);
    if (!state.openingBalanceEquityId) {
      throw new UserFacingError("This book is missing its Opening Balance Equity account.");
    }
    const eligible = new Map(state.accounts.map((a) => [a.id, a]));
    const changes: { accountId: string; before: unknown; after: unknown }[] = [];
    for (const [accountId, text] of Object.entries(rawAmounts)) {
      const account = eligible.get(accountId);
      if (!account || !isAccountType(account.type)) continue;
      const t = text.trim();
      const before = account.anchored
        ? { balanceCents: account.naturalCents, asOf: account.asOf }
        : null;
      if (!t) {
        if (account.anchored) {
          await tx.delete(openingBalances).where(eq(openingBalances.accountId, accountId));
          changes.push({ accountId, before, after: null });
        }
        continue;
      }
      let natural: number;
      try {
        natural = parseCents(t);
      } catch (e) {
        throw new UserFacingError(`${account.name}: ${(e as Error).message}`, accountId);
      }
      const rawDate =
        typeof asOf === "string" ? asOf : (asOf?.[accountId] ?? account.asOf ?? book.startDate);
      const parsedDate = anchorDate.safeParse(rawDate ?? "");
      if (!parsedDate.success) {
        throw new UserFacingError(
          `${account.name}: ${parsedDate.error.issues[0]!.message}`,
          `asof-${accountId}`,
        );
      }
      const date = parsedDate.data;
      if (account.anchored && account.naturalCents === natural && account.asOf === date) continue;
      await tx
        .insert(openingBalances)
        .values({ accountId, bookId, asOf: date, balanceCents: natural })
        .onConflictDoUpdate({
          target: openingBalances.accountId,
          set: { asOf: date, balanceCents: natural, updatedAt: new Date() },
        });
      changes.push({ accountId, before, after: { balanceCents: natural, asOf: date } });
    }
    for (const c of changes) {
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "opening_balance",
        entityId: c.accountId,
        action: c.before ? (c.after ? "update" : "delete") : "create",
        before: c.before ?? undefined,
        after: c.after ?? undefined,
      });
    }
    await keepOpeningBalances(
      tx,
      actor,
      bookId,
      changes.filter((c) => !c.after).map((c) => c.accountId),
    );
    return { changed: changes.length > 0 };
  });
}

/**
 * An entry that records bank transactions must keep recording them: the net
 * on each linked bank account has to stay equal to the bank's amounts.
 */
async function assertBankLinksKept(tx: DbOrTx, entryId: string, lines: ParsedLine[]) {
  const links = await tx
    .select({
      accountId: bankTransactions.accountId,
      amountCents: bankTransactions.amountCents,
      name: accounts.name,
    })
    .from(bankTransactions)
    .innerJoin(accounts, eq(accounts.id, bankTransactions.accountId))
    .where(eq(bankTransactions.entryId, entryId));
  const expected = new Map<string, { cents: number; name: string }>();
  for (const l of links) {
    const prev = expected.get(l.accountId)?.cents ?? 0;
    expected.set(l.accountId, { cents: prev + l.amountCents, name: l.name });
  }
  const buckets = expected.size
    ? await tx
        .select({ id: accounts.id, parentAccountId: accounts.parentAccountId })
        .from(accounts)
        .where(
          and(inArray(accounts.parentAccountId, [...expected.keys()]), eq(accounts.isBucket, true)),
        )
    : [];
  for (const [accountId, { cents, name }] of expected) {
    // An account with buckets holds its money in them, so count their lines too.
    const ids = new Set([
      accountId,
      ...buckets.filter((b) => b.parentAccountId === accountId).map((b) => b.id),
    ]);
    const net = lines
      .filter((l) => ids.has(l.accountId))
      .reduce((sum, l) => sum + l.debitCents - l.creditCents, 0);
    if (net !== cents) {
      throw new UserFacingError(
        `This entry records a bank transaction of ${formatCents(cents)} on ${name}, so its ${name} lines must still come to that amount. To undo the bank match, reverse the entry instead.`,
        "lines",
      );
    }
  }
}

/** editEntry's core, for callers that already hold a transaction (opening balances). */
async function editEntryInTx(
  tx: DbOrTx,
  actor: Actor,
  book: { id: string; startDate: string },
  entryId: string,
  input: EntryInput,
) {
  const { entry } = await loadEntryForChange(tx, book.id, entryId);
  const beforeLines = await currentLines(tx, entryId, entry.currentVersion);
  // A parent the entry already used stays allowed, so older entries can still be edited.
  const lines = await validateLines(tx, book.id, input.lines, {
    allowParents: beforeLines.map((b) => b.accountId),
  });
  await assertBankLinksKept(tx, entryId, lines);
  const payee = input.payee === undefined ? entry.payee : input.payee;
  const same =
    input.entryDate === entry.entryDate &&
    (payee ?? null) === (entry.payee ?? null) &&
    (input.memo ?? null) === (entry.memo ?? null) &&
    beforeLines.length === lines.length &&
    beforeLines.every(
      (b, i) =>
        b.accountId === lines[i]!.accountId &&
        b.debitCents === lines[i]!.debitCents &&
        b.creditCents === lines[i]!.creditCents &&
        (b.memo ?? null) === lines[i]!.memo,
    );
  if (same) return { entry, changed: false };
  const version = entry.currentVersion + 1;
  await tx
    .update(journalLines)
    .set({ isCurrent: false })
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.isCurrent, true)));
  await insertVersion(tx, {
    actor,
    bookId: book.id,
    entryId,
    version,
    entryDate: input.entryDate,
    payee,
    memo: input.memo,
    changeNote: "Edited",
    lines,
  });
  const [after] = await tx
    .update(journalEntries)
    .set({ currentVersion: version, entryDate: input.entryDate, payee, memo: input.memo })
    .where(eq(journalEntries.id, entryId))
    .returning();
  await recordAudit(tx, {
    bookId: book.id,
    userId: actor.userId,
    entityType: "journal_entry",
    entityId: entryId,
    action: "update",
    before: { ...entry, lines: beforeLines },
    after: { ...after, lines },
  });
  const earliest = input.entryDate < entry.entryDate ? input.entryDate : entry.entryDate;
  if (entry.kind !== "opening_balance" && (await openingMayChange(tx, book.id, earliest))) {
    await keepOpeningBalances(tx, actor, book.id);
  }
  return { entry: after!, changed: true };
}

// ---------------------------------------------------------------------------
// Reading entries
// ---------------------------------------------------------------------------

export type EntryListItem = {
  id: string;
  entryNumber: number;
  kind: string;
  entryDate: string;
  payee: string | null;
  memo: string | null;
  totalCents: number;
  lineCount: number;
  accountNames: string[];
  currentVersion: number;
  reversed: boolean;
};

export async function listEntries(
  db: DbOrTx,
  bookId: string,
  options: { limit?: number; offset?: number; all?: boolean } = {},
): Promise<{ items: EntryListItem[]; total: number }> {
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = Math.max(options.offset ?? 0, 0);
  // By default the journal shows the entries you write yourself, like QuickBooks:
  // manual entries, opening balances, and reversals of those. Entries made from
  // bank transactions, transfers, bucket moves and investment values live in the
  // registers, the general ledger and For review's Posted tab.
  const own = options.all
    ? sql`true`
    : sql`(e.kind in ('manual', 'opening_balance')
           or (e.kind = 'reversal' and exists (
             select 1 from journal_entries o
             where o.id = e.reverses_entry_id and o.kind in ('manual', 'opening_balance'))))`;
  const result = await db.execute<{
    id: string;
    entry_number: number;
    kind: string;
    entry_date: string;
    payee: string | null;
    memo: string | null;
    total: string;
    line_count: number;
    names: string[] | null;
    current_version: number;
    reversed: boolean;
  }>(sql`
    select e.id, e.entry_number, e.kind, e.entry_date::text as entry_date, e.payee, e.memo, e.current_version,
           coalesce(sum(l.debit_cents), 0)::text as total,
           count(l.id)::int as line_count,
           array_agg(distinct a.name) filter (where a.name is not null) as names,
           exists (select 1 from journal_entries r where r.reverses_entry_id = e.id) as reversed
    from journal_entries e
    left join journal_lines l on l.entry_id = e.id and l.version = e.current_version and l.is_current
    left join accounts a on a.id = l.account_id
    where e.book_id = ${bookId} and ${own}
    group by e.id
    order by e.entry_date desc, e.entry_number desc
    limit ${limit} offset ${offset}
  `);
  const count = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from journal_entries e where e.book_id = ${bookId} and ${own}`,
  );
  return {
    total: Number(count.rows[0]?.n ?? 0),
    items: result.rows.map((r) => ({
      id: r.id,
      entryNumber: Number(r.entry_number),
      kind: r.kind,
      entryDate: r.entry_date,
      payee: r.payee,
      memo: r.memo,
      totalCents: Number(r.total),
      lineCount: Number(r.line_count),
      accountNames: (r.names ?? []).sort(),
      currentVersion: Number(r.current_version),
      reversed: Boolean(r.reversed),
    })),
  };
}

export type EntryDetail = {
  entry: typeof journalEntries.$inferSelect;
  shownVersion: number;
  versionHeader: { entryDate: string; payee: string | null; memo: string | null };
  lines: {
    id: string;
    lineNumber: number;
    accountId: string;
    accountName: string;
    accountCode: string | null;
    debitCents: number;
    creditCents: number;
    memo: string | null;
  }[];
  versions: {
    version: number;
    entryDate: string;
    payee: string | null;
    memo: string | null;
    changeNote: string | null;
    createdAt: Date;
    createdByName: string | null;
  }[];
  reversedBy: { id: string; entryNumber: number } | null;
  reverses: { id: string; entryNumber: number } | null;
};

export async function getEntryDetail(
  db: DbOrTx,
  bookId: string,
  entryId: string,
  version?: number,
): Promise<EntryDetail> {
  if (!z.uuid().safeParse(entryId).success) throw new NotFoundError("That journal entry");
  const [entry] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.bookId, bookId)));
  if (!entry) throw new NotFoundError("That journal entry");

  const versions = await db
    .select({
      version: journalEntryVersions.version,
      entryDate: journalEntryVersions.entryDate,
      payee: journalEntryVersions.payee,
      memo: journalEntryVersions.memo,
      changeNote: journalEntryVersions.changeNote,
      createdAt: journalEntryVersions.createdAt,
      createdByName: users.name,
    })
    .from(journalEntryVersions)
    .leftJoin(users, eq(users.id, journalEntryVersions.createdBy))
    .where(eq(journalEntryVersions.entryId, entryId))
    .orderBy(desc(journalEntryVersions.version));

  const shown =
    version && versions.some((v) => v.version === version) ? version : entry.currentVersion;
  const header = versions.find((v) => v.version === shown)!;

  const lines = await db
    .select({
      id: journalLines.id,
      lineNumber: journalLines.lineNumber,
      accountId: journalLines.accountId,
      accountName: accounts.name,
      accountCode: accounts.code,
      debitCents: journalLines.debitCents,
      creditCents: journalLines.creditCents,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(accounts, eq(accounts.id, journalLines.accountId))
    .where(and(eq(journalLines.entryId, entryId), eq(journalLines.version, shown)))
    .orderBy(journalLines.lineNumber);

  const [reversedBy] = await db
    .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber })
    .from(journalEntries)
    .where(eq(journalEntries.reversesEntryId, entryId));
  const [reverses] = entry.reversesEntryId
    ? await db
        .select({ id: journalEntries.id, entryNumber: journalEntries.entryNumber })
        .from(journalEntries)
        .where(eq(journalEntries.id, entry.reversesEntryId))
    : [];

  return {
    entry,
    shownVersion: shown,
    versionHeader: { entryDate: header.entryDate, payee: header.payee, memo: header.memo },
    lines,
    versions,
    reversedBy: reversedBy ?? null,
    reverses: reverses ?? null,
  };
}

/**
 * Sets one account's anchored balance (in its natural direction, for example
 * what a card owes as a positive amount) on a date, leaving every other account's.
 */
export async function setOpeningBalanceFor(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  naturalCents: number,
  asOf?: string,
) {
  return saveOpeningBalances(
    db,
    actor,
    bookId,
    { [accountId]: centsText(naturalCents) },
    asOf ? { [accountId]: asOf } : undefined,
  );
}
