import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { type AccountType, isAccountType } from "@/lib/account-types";
import {
  type DraftLine,
  type ParsedLine,
  formatEntryNumber,
  naturalToSides,
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

export function assertDateAllowed(entryDate: string, startDate: string) {
  if (entryDate < startDate) {
    throw new UserFacingError(
      `Entries start on the book's start date (${formatDate(startDate)}). Use opening balances for anything earlier.`,
      "entryDate",
    );
  }
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
  return entry!;
}

/** Posts a new manual journal entry. */
export async function postEntry(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const input = parseEntryInput(raw);
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    assertDateAllowed(input.entryDate, book.startDate);
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
    assertDateAllowed(input.entryDate, book.startDate);
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
    const book = await loadBookForPosting(tx, bookId);
    const { entry, reversedBy } = await loadEntryForChange(tx, bookId, entryId);
    if (entry.kind === "reversal") {
      throw new UserFacingError("A reversal can't be reversed. Post a new entry instead.");
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
    assertDateAllowed(date, book.startDate);
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
  /** Current opening amount in the account's natural direction. */
  naturalCents: number;
};

/** Balance sheet accounts that can hold an opening balance. */
export async function openingBalanceState(db: DbOrTx, bookId: string) {
  const [opening] = await db
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.bookId, bookId), eq(journalEntries.kind, "opening_balance")));
  const lines = opening ? await currentLines(db, opening.id, opening.currentVersion) : [];
  const [reversal] = opening
    ? await db
        .select({ entryNumber: journalEntries.entryNumber })
        .from(journalEntries)
        .where(eq(journalEntries.reversesEntryId, opening.id))
    : [];
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const obe = all.find((a) => a.systemRole === "opening_balance_equity");
  const amounts = new Map<string, number>();
  for (const l of lines) {
    amounts.set(l.accountId, (amounts.get(l.accountId) ?? 0) + l.debitCents - l.creditCents);
  }
  const eligible: OpeningAccount[] = all
    .filter(
      (a) =>
        ["asset", "liability", "equity"].includes(a.type) &&
        !a.systemRole &&
        a.allowsPosting &&
        (!a.archivedAt || amounts.has(a.id)),
    )
    .map((a) => {
      const net = amounts.get(a.id) ?? 0;
      const type = a.type as AccountType;
      return {
        id: a.id,
        name: a.name,
        code: a.code,
        type,
        subtype: a.subtype,
        parentAccountId: a.parentAccountId,
        sortOrder: a.sortOrder,
        archivedAt: a.archivedAt,
        naturalCents: type === "asset" ? net : -net,
      };
    });
  return {
    entry: opening ?? null,
    reversedByNumber: reversal?.entryNumber ?? null,
    accounts: eligible,
    openingBalanceEquityId: obe?.id ?? null,
    openingBalanceEquityNet: obe ? (amounts.get(obe.id) ?? 0) : 0,
  };
}

/**
 * Saves opening balances as one entry dated on the book's start date, with the
 * difference posted to Opening Balance Equity. Saving again creates a new
 * version of the same entry.
 */
export async function saveOpeningBalances(
  db: Database,
  actor: Actor,
  bookId: string,
  rawAmounts: Record<string, string>,
) {
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    const state = await openingBalanceState(tx, bookId);
    if (!state.openingBalanceEquityId) {
      throw new UserFacingError("This book is missing its Opening Balance Equity account.");
    }
    if (state.reversedByNumber) {
      throw new UserFacingError(
        `The opening balance entry was reversed by ${formatEntryNumber(state.reversedByNumber)}, so it can't be changed here.`,
      );
    }
    const eligible = new Map(state.accounts.map((a) => [a.id, a]));
    const lines: ParsedLine[] = [];
    let offset = 0;
    for (const [accountId, text] of Object.entries(rawAmounts)) {
      const account = eligible.get(accountId);
      if (!account) continue;
      const t = text.trim();
      if (!t) continue;
      let natural: number;
      try {
        natural = parseCents(t);
      } catch (e) {
        throw new UserFacingError(`${account.name}: ${(e as Error).message}`, accountId);
      }
      if (natural === 0) continue;
      if (!isAccountType(account.type)) continue;
      const sides = naturalToSides(account.type, natural);
      offset += sides.debitCents - sides.creditCents;
      lines.push({ accountId, ...sides, memo: null });
    }
    if (lines.length === 0) {
      if (state.entry) {
        throw new UserFacingError(
          "Opening balances can't all be zero once saved. Change the amounts, or reverse the entry from the journal.",
        );
      }
      return { entry: null, changed: false };
    }
    if (offset !== 0) {
      lines.push({
        accountId: state.openingBalanceEquityId,
        debitCents: offset < 0 ? -offset : 0,
        creditCents: offset > 0 ? offset : 0,
        memo: null,
      });
    }
    // Every line balances against Opening Balance Equity, so this always balances.
    const draft: DraftLine[] = lines.map((l) => ({
      accountId: l.accountId,
      debit: l.debitCents ? centsText(l.debitCents) : "",
      credit: l.creditCents ? centsText(l.creditCents) : "",
      memo: "",
    }));
    const input = {
      entryDate: book.startDate,
      payee: null,
      memo: "Opening balances",
      lines: draft,
    };
    if (state.entry) {
      // A single account plus its offset still needs two lines; that holds here.
      const result = await editEntryInTx(tx, actor, book, state.entry.id, input);
      return result;
    }
    const validated = await validateLines(tx, bookId, draft, { allowParents: "all" });
    const entry = await createEntry(tx, {
      actor,
      bookId,
      kind: "opening_balance",
      entryDate: book.startDate,
      memo: "Opening balances",
      lines: validated,
      changeNote: "Created",
    });
    return { entry, changed: true };
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
 * Sets one account's opening balance (in its natural direction, for example
 * what a card owes as a positive amount), keeping every other account's.
 */
export async function setOpeningBalanceFor(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  naturalCents: number,
) {
  const state = await openingBalanceState(db, bookId);
  const amounts: Record<string, string> = {};
  for (const a of state.accounts) {
    if (a.naturalCents !== 0) amounts[a.id] = centsText(a.naturalCents);
  }
  amounts[accountId] = centsText(naturalCents);
  if (Object.values(amounts).every((v) => v === "0.00")) return null;
  return saveOpeningBalances(db, actor, bookId, amounts);
}
