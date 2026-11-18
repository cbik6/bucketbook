import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { DraftLine } from "@/lib/ledger-math";
import { formatCents, parseCents } from "@/lib/money";
import { payeeKey } from "@/lib/rules";
import { type MatchItem, pairTransfers } from "@/lib/transfer-match";
import { recordAudit } from "../audit/record";
import { requireBookAccess } from "../books/service";
import type { Database, DbOrTx } from "../db/client";
import { uuidArray } from "../db/sql";
import {
  type BankTxStatus,
  accounts,
  bankRules,
  bankTransactions,
  bookCounterparts,
  bookMembers,
  books,
  journalEntries,
} from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";
import {
  assertDateAllowed,
  createEntry,
  loadBookForPosting,
  validateLines,
} from "../ledger/service";
import { applyRules } from "./rules-service";

type Actor = { userId: string };

const centsText = (cents: number) => formatCents(cents, { showSymbol: false });

/** Debit/credit for the bank side: a positive bank amount is a debit. */
function bankSide(amountCents: number) {
  return amountCents > 0
    ? { debit: centsText(amountCents), credit: "" }
    : { debit: "", credit: centsText(-amountCents) };
}

/** The offset side mirrors the bank side. */
function offsetSide(amountCents: number, part: number) {
  return amountCents > 0
    ? { debit: "", credit: centsText(part) }
    : { debit: centsText(part), credit: "" };
}

type ItemRow = typeof bankTransactions.$inferSelect;

async function lockItem(tx: DbOrTx, bookId: string, itemId: string): Promise<ItemRow> {
  if (!z.uuid().safeParse(itemId).success) throw new NotFoundError("That transaction");
  const result = await tx.execute<{ id: string }>(
    sql`select id from bank_transactions where id = ${itemId} and book_id = ${bookId} for update`,
  );
  if (!result.rows[0]) throw new NotFoundError("That transaction");
  const [row] = await tx.select().from(bankTransactions).where(eq(bankTransactions.id, itemId));
  return row!;
}

function assertReviewable(item: ItemRow) {
  if (item.status === "pending") {
    throw new UserFacingError(
      "This transaction is still pending. It can be approved once it clears.",
    );
  }
  if (item.status === "posted") throw new UserFacingError("This transaction is already recorded.");
  if (item.status !== "review") {
    throw new UserFacingError("This transaction isn't waiting for review any more.");
  }
}

async function markPosted(
  tx: DbOrTx,
  actor: Actor,
  item: ItemRow,
  entryId: string,
  method: "approved" | "transfer" | "linked",
) {
  await tx
    .update(bankTransactions)
    .set({ status: "posted", entryId, postMethod: method, duplicateOfId: null })
    .where(eq(bankTransactions.id, item.id));
  await recordAudit(tx, {
    bookId: item.bookId,
    userId: actor.userId,
    entityType: "bank_transaction",
    entityId: item.id,
    action: "approve",
    after: { entryId, method, amountCents: item.amountCents, description: item.description },
  });
}

const splitSchema = z.object({
  accountId: z.string().min(1, "Pick an account for every split line."),
  amount: z.string(),
  memo: z.string().trim().max(500).default(""),
});

const approveSchema = z.object({
  /** One account for the whole amount... */
  accountId: z.string().optional(),
  /** ...or several split lines that add up to it. */
  splits: z.array(splitSchema).max(100).optional(),
  payee: z.string().trim().max(200).optional(),
  memo: z.string().trim().max(500).optional(),
  /** Save "this payee goes to this account" as a rule. */
  saveRule: z.boolean().optional(),
});

export type ApproveInput = z.input<typeof approveSchema>;

/**
 * Approves one transaction from For review: posts a journal entry with the
 * bank line and one offset line (or several, for a split).
 */
export async function approveItem(
  db: Database,
  actor: Actor,
  bookId: string,
  itemId: string,
  raw: unknown,
) {
  const parsed = approveSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]!.message);
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    const item = await lockItem(tx, bookId, itemId);
    assertReviewable(item);
    assertDateAllowed(item.postedDate, book.startDate);
    const size = Math.abs(item.amountCents);

    const lines: DraftLine[] = [
      { accountId: item.accountId, ...bankSide(item.amountCents), memo: "" },
    ];
    if (input.splits && input.splits.length > 0) {
      let total = 0;
      for (const [i, s] of input.splits.entries()) {
        let cents: number;
        try {
          cents = parseCents(s.amount);
        } catch {
          throw new UserFacingError(`Split line ${i + 1}: enter an amount.`, "splits");
        }
        if (cents <= 0) {
          throw new UserFacingError(`Split line ${i + 1}: amounts must be above zero.`, "splits");
        }
        total += cents;
        lines.push({
          accountId: s.accountId,
          ...offsetSide(item.amountCents, cents),
          memo: s.memo,
        });
      }
      if (total !== size) {
        throw new UserFacingError(
          `The split lines add up to ${formatCents(total)} but the transaction is ${formatCents(size)}. ${total > size ? "Remove" : "Add"} ${formatCents(Math.abs(size - total))}.`,
          "splits",
        );
      }
    } else {
      const accountId = input.accountId || item.suggestedAccountId;
      if (!accountId) throw new UserFacingError("Pick a category first.", "accountId");
      lines.push({ accountId, ...offsetSide(item.amountCents, size), memo: "" });
    }
    if (lines.slice(1).some((l) => l.accountId === item.accountId)) {
      throw new UserFacingError(
        "The category can't be the same account the transaction is on.",
        "accountId",
      );
    }
    const validated = await validateLines(tx, bookId, lines);
    const payee = (input.payee ?? item.suggestedPayee ?? item.payee ?? item.description) || null;
    const memo = (input.memo ?? item.suggestedMemo ?? "") || null;
    const entry = await createEntry(tx, {
      actor,
      bookId,
      kind: "bank",
      entryDate: item.postedDate,
      payee,
      memo,
      lines: validated,
      changeNote: "Approved from review",
    });
    await markPosted(tx, actor, item, entry.id, "approved");

    let ruleCreated = false;
    if (input.saveRule && lines.length === 2 && payee) {
      ruleCreated = await saveRuleForPayee(tx, actor, bookId, item, lines[1]!.accountId, payee);
    }
    return { entry, ruleCreated };
  });
}

/** Creates "payee is X: use this account" unless an equivalent rule exists. */
async function saveRuleForPayee(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  item: ItemRow,
  accountId: string,
  payee: string,
): Promise<boolean> {
  const match = payeeKey({ payee: item.payee, description: item.description });
  const conditions = {
    text: { field: item.payee ? "payee" : "description", op: "equals", value: match },
    direction: item.amountCents < 0 ? "outflow" : "inflow",
  };
  const actions = {
    offsetAccountId: accountId,
    payee: payee !== match ? payee : null,
    transfer: false,
  };
  const existing = await tx
    .select({ id: bankRules.id })
    .from(bankRules)
    .where(
      and(
        eq(bankRules.bookId, bookId),
        sql`${bankRules.conditions} @> ${JSON.stringify({ text: { value: match } })}::jsonb`,
      ),
    )
    .limit(1);
  if (existing.length > 0) return false;
  const next = await tx.execute<{ p: number }>(
    sql`select coalesce(max(priority), 0) + 1 as p from bank_rules where book_id = ${bookId}`,
  );
  const [rule] = await tx
    .insert(bankRules)
    .values({
      bookId,
      name: payee.slice(0, 100),
      priority: Number(next.rows[0]!.p),
      conditions,
      actions,
    })
    .returning();
  await recordAudit(tx, {
    bookId,
    userId: actor.userId,
    entityType: "bank_rule",
    entityId: rule!.id,
    action: "create",
    after: rule,
  });
  await applyRules(tx, bookId);
  return true;
}

/**
 * Approves every listed transaction that has a suggested category, each in
 * its own transaction so one problem doesn't block the rest.
 */
export type Decision =
  | { id: string; kind: "account"; accountId?: string }
  | { id: string; kind: "transfer"; partnerId: string }
  | { id: string; kind: "link"; entryId: string };

/**
 * Approves several transactions, each in its own database transaction so one
 * problem doesn't block the rest. A transfer pair counts once even when both
 * sides are selected.
 */
export async function applyDecisions(
  db: Database,
  actor: Actor,
  bookId: string,
  decisions: Decision[],
) {
  const results = { approved: 0, skipped: [] as Array<{ id: string; reason: string }> };
  const done = new Set<string>();
  for (const d of decisions.slice(0, 500)) {
    if (done.has(d.id)) continue;
    try {
      if (d.kind === "transfer") {
        await approveTransfer(db, actor, bookId, d.id, { partnerId: d.partnerId });
        done.add(d.partnerId);
      } else if (d.kind === "link") {
        await linkToEntry(db, actor, bookId, d.id, d.entryId);
      } else {
        await approveItem(db, actor, bookId, d.id, { accountId: d.accountId });
      }
      done.add(d.id);
      results.approved += 1;
    } catch (err) {
      if (err instanceof UserFacingError) results.skipped.push({ id: d.id, reason: err.message });
      else throw err;
    }
  }
  return results;
}

/** Approves each listed transaction with its suggested category. */
export async function bulkApprove(db: Database, actor: Actor, bookId: string, itemIds: string[]) {
  return applyDecisions(
    db,
    actor,
    bookId,
    [...new Set(itemIds)].map((id) => ({ id, kind: "account" as const })),
  );
}

const transferSchema = z.object({
  partnerId: z.string(),
  /** For a transfer between books: the account standing for the other book, in each book. */
  counterpartAccountId: z.string().optional(),
  partnerCounterpartAccountId: z.string().optional(),
  memo: z.string().trim().max(500).optional(),
});

/**
 * Records a matched pair as a transfer. In one book it is a single entry
 * between the two accounts. Across books each book posts its own side against
 * the account that stands for the other book, and the two entries share a
 * transfer group so each can point at the other.
 */
export async function approveTransfer(
  db: Database,
  actor: Actor,
  bookId: string,
  itemId: string,
  raw: unknown,
) {
  const parsed = transferSchema.safeParse(raw);
  if (!parsed.success) throw new UserFacingError(parsed.error.issues[0]!.message);
  const input = parsed.data;
  if (!z.uuid().safeParse(input.partnerId).success) throw new NotFoundError("The other side");

  // Which book is the partner in? Check access before locking anything.
  const [partnerRef] = await db
    .select({ bookId: bankTransactions.bookId })
    .from(bankTransactions)
    .where(eq(bankTransactions.id, input.partnerId));
  if (!partnerRef) throw new NotFoundError("The other side");
  const otherBookId = partnerRef.bookId;
  if (otherBookId !== bookId) await requireBookAccess(db, actor.userId, otherBookId, "editor");

  return db.transaction(async (tx) => {
    // Lock books, then items, in a fixed order so two people can't deadlock.
    const bookIds = [...new Set([bookId, otherBookId])].sort();
    const locked = new Map<string, { id: string; startDate: string }>();
    for (const id of bookIds) locked.set(id, await loadBookForPosting(tx, id));
    const [firstId, secondId] = [itemId, input.partnerId].sort();
    const lockedItems = new Map<string, ItemRow>();
    for (const id of [firstId!, secondId!]) {
      const owner = id === itemId ? bookId : otherBookId;
      lockedItems.set(id, await lockItem(tx, owner, id));
    }
    const item = lockedItems.get(itemId)!;
    const partner = lockedItems.get(input.partnerId)!;
    assertReviewable(item);
    assertReviewable(partner);
    if (item.amountCents !== -partner.amountCents) {
      throw new UserFacingError(
        "These two transactions aren't equal and opposite, so they can't be one transfer.",
      );
    }
    if (item.accountId === partner.accountId) {
      throw new UserFacingError("Both transactions are on the same account.");
    }
    assertDateAllowed(item.postedDate, locked.get(bookId)!.startDate);
    assertDateAllowed(partner.postedDate, locked.get(otherBookId)!.startDate);
    const memo = input.memo || null;

    if (otherBookId === bookId) {
      const outflow = item.amountCents < 0 ? item : partner;
      const lines = await validateLines(tx, bookId, [
        { accountId: item.accountId, ...bankSide(item.amountCents), memo: "" },
        { accountId: partner.accountId, ...bankSide(partner.amountCents), memo: "" },
      ]);
      const entry = await createEntry(tx, {
        actor,
        bookId,
        kind: "transfer",
        entryDate: outflow.postedDate,
        memo: memo ?? "Transfer",
        lines,
        changeNote: "Matched transfer",
      });
      await markPosted(tx, actor, item, entry.id, "transfer");
      await markPosted(tx, actor, partner, entry.id, "transfer");
      return { entries: [entry] };
    }

    const mine = await counterpartFor(tx, bookId, otherBookId, input.counterpartAccountId);
    const theirs = await counterpartFor(tx, otherBookId, bookId, input.partnerCounterpartAccountId);
    if (!mine || !theirs) {
      throw new UserFacingError(
        "Pick the account that stands for the other book on each side (for example Owner Contribution in a business, or Investment in the business at home).",
        "counterpart",
      );
    }
    const [bookNames] = [
      await tx
        .select({ id: books.id, name: books.name })
        .from(books)
        .where(inArray(books.id, [bookId, otherBookId])),
    ];
    const nameOf = (id: string) => bookNames.find((b) => b.id === id)?.name ?? "the other book";
    const groupId = randomUUID();
    const entries = [];
    for (const [side, book, other, counterpart] of [
      [item, bookId, otherBookId, mine],
      [partner, otherBookId, bookId, theirs],
    ] as const) {
      const lines = await validateLines(tx, book, [
        { accountId: side.accountId, ...bankSide(side.amountCents), memo: "" },
        {
          accountId: counterpart,
          ...offsetSide(side.amountCents, Math.abs(side.amountCents)),
          memo: "",
        },
      ]);
      const entry = await createEntry(tx, {
        actor,
        bookId: book,
        kind: "transfer",
        entryDate: side.postedDate,
        payee: nameOf(other),
        memo: memo ?? `Transfer ${side.amountCents < 0 ? "to" : "from"} ${nameOf(other)}`,
        lines,
        transferGroupId: groupId,
        changeNote: "Matched transfer between books",
      });
      await markPosted(tx, actor, side, entry.id, "transfer");
      await tx
        .insert(bookCounterparts)
        .values({ bookId: book, otherBookId: other, accountId: counterpart })
        .onConflictDoUpdate({
          target: [bookCounterparts.bookId, bookCounterparts.otherBookId],
          set: { accountId: counterpart, updatedAt: sql`now()` },
        });
      entries.push(entry);
    }
    return { entries };
  });
}

/** The chosen (or remembered) account in `bookId` that stands for `otherBookId`. */
async function counterpartFor(
  tx: DbOrTx,
  bookId: string,
  otherBookId: string,
  chosen: string | undefined,
): Promise<string | null> {
  if (chosen) {
    if (!z.uuid().safeParse(chosen).success) return null;
    const [a] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, chosen), eq(accounts.bookId, bookId)));
    if (!a) throw new UserFacingError("That account isn't in the right book.", "counterpart");
    return a.id;
  }
  const [saved] = await tx
    .select({ accountId: bookCounterparts.accountId })
    .from(bookCounterparts)
    .where(and(eq(bookCounterparts.bookId, bookId), eq(bookCounterparts.otherBookId, otherBookId)));
  return saved?.accountId ?? null;
}

/**
 * Links a transaction to an entry that already records it (typed by hand, or
 * the other side of a transfer that was categorized from one account only).
 */
export async function linkToEntry(
  db: Database,
  actor: Actor,
  bookId: string,
  itemId: string,
  entryId: string,
) {
  if (!z.uuid().safeParse(entryId).success) throw new NotFoundError("That journal entry");
  return db.transaction(async (tx) => {
    await loadBookForPosting(tx, bookId);
    const item = await lockItem(tx, bookId, itemId);
    assertReviewable(item);
    const candidates = await linkCandidates(tx, bookId, [item]);
    if (!candidates.get(item.id)?.some((c) => c.entryId === entryId)) {
      throw new UserFacingError(
        "That entry doesn't record this amount on this account, or it already matches another bank transaction.",
      );
    }
    await markPosted(tx, actor, item, entryId, "linked");
  });
}

export async function excludeItem(db: Database, actor: Actor, bookId: string, itemId: string) {
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, bookId, itemId);
    if (item.status !== "review" && item.status !== "pending") {
      throw new UserFacingError("Only transactions waiting for review can be excluded.");
    }
    await tx
      .update(bankTransactions)
      .set({ status: "excluded" })
      .where(eq(bankTransactions.id, itemId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_transaction",
      entityId: itemId,
      action: "exclude",
      before: { status: item.status },
      after: { description: item.description, amountCents: item.amountCents },
    });
  });
}

export async function restoreItem(db: Database, actor: Actor, bookId: string, itemId: string) {
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, bookId, itemId);
    if (item.status !== "excluded") throw new UserFacingError("That transaction isn't excluded.");
    await tx
      .update(bankTransactions)
      .set({ status: "review", duplicateOfId: null })
      .where(eq(bankTransactions.id, itemId));
    await applyRules(tx, bookId, [itemId]);
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_transaction",
      entityId: itemId,
      action: "restore",
      after: { description: item.description, amountCents: item.amountCents },
    });
  });
}

/** "Not a duplicate": clears the flag so it can be approved normally. */
export async function keepBoth(db: Database, actor: Actor, bookId: string, itemId: string) {
  return db.transaction(async (tx) => {
    const item = await lockItem(tx, bookId, itemId);
    if (!item.duplicateOfId) return;
    await tx
      .update(bankTransactions)
      .set({ duplicateOfId: null })
      .where(eq(bankTransactions.id, itemId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_transaction",
      entityId: itemId,
      action: "update",
      after: { notDuplicateOf: item.duplicateOfId },
    });
  });
}

// ---------------------------------------------------------------------------
// Reading the queue
// ---------------------------------------------------------------------------

export const LINK_WINDOW_DAYS = 5;

export type LinkCandidate = {
  entryId: string;
  entryNumber: number;
  entryDate: string;
  payee: string | null;
  memo: string | null;
};

/**
 * Existing entries that already record each item: a current line on the same
 * account for the same net amount, a few days apart, not yet matched to
 * another bank transaction on that account, and not reversed.
 */
export async function linkCandidates(
  db: DbOrTx,
  bookId: string,
  items: Pick<ItemRow, "id" | "accountId" | "amountCents" | "postedDate">[],
): Promise<Map<string, LinkCandidate[]>> {
  const out = new Map<string, LinkCandidate[]>();
  if (items.length === 0) return out;
  const accountIds = [...new Set(items.map((i) => i.accountId))];
  const result = await db.execute<{
    entry_id: string;
    entry_number: number;
    entry_date: string;
    entry_payee: string | null;
    entry_memo: string | null;
    account_id: string;
    net: string;
  }>(sql`
    select l.entry_id, l.entry_number, l.entry_date::text as entry_date, l.entry_payee, l.entry_memo,
           l.account_id, sum(l.net_cents)::text as net
    from ledger_lines l
    where l.book_id = ${bookId}
      and l.account_id = any(${uuidArray(accountIds)})
      and l.entry_kind not in ('reversal', 'opening_balance')
      and not exists (select 1 from journal_entries r where r.reverses_entry_id = l.entry_id)
      and not exists (
        select 1 from bank_transactions b
        where b.entry_id = l.entry_id and b.account_id = l.account_id
      )
    group by l.entry_id, l.entry_number, l.entry_date, l.entry_payee, l.entry_memo, l.account_id
  `);
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  for (const item of items) {
    const matches = result.rows
      .filter(
        (r) =>
          r.account_id === item.accountId &&
          Number(r.net) === item.amountCents &&
          Math.abs(day(r.entry_date) - day(item.postedDate)) <= LINK_WINDOW_DAYS,
      )
      .sort(
        (a, b) =>
          Math.abs(day(a.entry_date) - day(item.postedDate)) -
          Math.abs(day(b.entry_date) - day(item.postedDate)),
      )
      .slice(0, 3)
      .map((r) => ({
        entryId: r.entry_id,
        entryNumber: Number(r.entry_number),
        entryDate: r.entry_date,
        payee: r.entry_payee,
        memo: r.entry_memo,
      }));
    if (matches.length) out.set(item.id, matches);
  }
  return out;
}

export type QueueTab = "review" | "pending" | "posted" | "excluded";

export type QueueItem = {
  id: string;
  accountId: string;
  accountName: string;
  source: string;
  postedDate: string;
  amountCents: number;
  description: string;
  payee: string | null;
  bankMemo: string | null;
  status: BankTxStatus;
  entryId: string | null;
  entryNumber: number | null;
  postMethod: string | null;
  suggestedAccountId: string | null;
  suggestedPayee: string | null;
  suggestedMemo: string | null;
  suggestedTransfer: boolean;
  suggestedRuleName: string | null;
  duplicateOf: { id: string; postedDate: string; description: string; status: string } | null;
  transfer: {
    id: string;
    bookId: string;
    bookName: string;
    accountName: string;
    postedDate: string;
    /** Saved accounts that stand for the other book, if any. */
    counterpartAccountId: string | null;
    partnerCounterpartAccountId: string | null;
  } | null;
  linkCandidates: LinkCandidate[];
  attachmentCount: number;
};

export async function queueCounts(db: DbOrTx, bookId: string): Promise<Record<QueueTab, number>> {
  const rows = await db
    .select({ status: bankTransactions.status, n: sql<number>`count(*)::int` })
    .from(bankTransactions)
    .where(eq(bankTransactions.bookId, bookId))
    .groupBy(bankTransactions.status);
  const counts: Record<QueueTab, number> = { review: 0, pending: 0, posted: 0, excluded: 0 };
  for (const r of rows) {
    if (r.status in counts) counts[r.status as QueueTab] = Number(r.n);
  }
  return counts;
}

export async function listQueue(
  db: DbOrTx,
  userId: string,
  bookId: string,
  tab: QueueTab,
  options: { accountId?: string; limit?: number } = {},
): Promise<QueueItem[]> {
  const limit = Math.min(options.limit ?? 300, 1000);
  const filters = [eq(bankTransactions.bookId, bookId), eq(bankTransactions.status, tab)];
  if (options.accountId && z.uuid().safeParse(options.accountId).success) {
    filters.push(eq(bankTransactions.accountId, options.accountId));
  }
  const rows = await db
    .select({
      item: bankTransactions,
      accountName: accounts.name,
      entryNumber: journalEntries.entryNumber,
      ruleName: bankRules.name,
      attachmentCount: sql<number>`(select count(*)::int from attachments t where t.bank_transaction_id = ${bankTransactions.id})`,
    })
    .from(bankTransactions)
    .innerJoin(accounts, eq(accounts.id, bankTransactions.accountId))
    .leftJoin(journalEntries, eq(journalEntries.id, bankTransactions.entryId))
    .leftJoin(bankRules, eq(bankRules.id, bankTransactions.suggestedRuleId))
    .where(and(...filters))
    .orderBy(
      tab === "posted" || tab === "excluded"
        ? desc(bankTransactions.postedDate)
        : asc(bankTransactions.postedDate),
      asc(bankTransactions.createdAt),
    )
    .limit(limit);

  const dupIds = rows.map((r) => r.item.duplicateOfId).filter((v): v is string => Boolean(v));
  const dups = dupIds.length
    ? await db
        .select({
          id: bankTransactions.id,
          postedDate: bankTransactions.postedDate,
          description: bankTransactions.description,
          status: bankTransactions.status,
        })
        .from(bankTransactions)
        .where(inArray(bankTransactions.id, dupIds))
    : [];
  const dupById = new Map(dups.map((d) => [d.id, d]));

  let transfers = new Map<string, MatchItem>();
  let links = new Map<string, LinkCandidate[]>();
  const partnerInfo = new Map<string, { bookName: string; accountName: string }>();
  const counterparts = new Map<string, string>();
  if (tab === "review") {
    const pool = await transferPool(db, userId);
    transfers = pairTransfers(pool.items);
    for (const [id, info] of pool.info) partnerInfo.set(id, info);
    const saved = await db
      .select()
      .from(bookCounterparts)
      .where(or(eq(bookCounterparts.bookId, bookId), eq(bookCounterparts.otherBookId, bookId)));
    for (const c of saved) counterparts.set(`${c.bookId}|${c.otherBookId}`, c.accountId);
    links = await linkCandidates(
      db,
      bookId,
      rows.map((r) => r.item),
    );
  }

  return rows.map(({ item, accountName, entryNumber, ruleName, attachmentCount }) => {
    const partner = transfers.get(item.id);
    const dup = item.duplicateOfId ? dupById.get(item.duplicateOfId) : undefined;
    return {
      id: item.id,
      accountId: item.accountId,
      accountName,
      source: item.source,
      postedDate: item.postedDate,
      amountCents: item.amountCents,
      description: item.description,
      payee: item.payee,
      bankMemo: item.bankMemo,
      status: item.status as BankTxStatus,
      entryId: item.entryId,
      entryNumber: entryNumber ?? null,
      postMethod: item.postMethod,
      suggestedAccountId: item.suggestedAccountId,
      suggestedPayee: item.suggestedPayee,
      suggestedMemo: item.suggestedMemo,
      suggestedTransfer: item.suggestedTransfer,
      suggestedRuleName: ruleName ?? null,
      duplicateOf: dup ? { ...dup, status: dup.status } : null,
      transfer: partner
        ? {
            id: partner.id,
            bookId: partner.bookId,
            bookName: partnerInfo.get(partner.id)?.bookName ?? "",
            accountName: partnerInfo.get(partner.id)?.accountName ?? "",
            postedDate: partner.postedDate,
            counterpartAccountId: counterparts.get(`${bookId}|${partner.bookId}`) ?? null,
            partnerCounterpartAccountId: counterparts.get(`${partner.bookId}|${bookId}`) ?? null,
          }
        : null,
      linkCandidates: links.get(item.id) ?? [],
      attachmentCount: Number(attachmentCount),
    };
  });
}

/** Every transaction in review across the books this user can edit, for transfer matching. */
async function transferPool(db: DbOrTx, userId: string) {
  const rows = await db
    .select({
      id: bankTransactions.id,
      bookId: bankTransactions.bookId,
      accountId: bankTransactions.accountId,
      amountCents: bankTransactions.amountCents,
      postedDate: bankTransactions.postedDate,
      bookName: books.name,
      accountName: accounts.name,
    })
    .from(bankTransactions)
    .innerJoin(books, eq(books.id, bankTransactions.bookId))
    .innerJoin(accounts, eq(accounts.id, bankTransactions.accountId))
    .innerJoin(bookMembers, and(eq(bookMembers.bookId, books.id), eq(bookMembers.userId, userId)))
    .where(
      and(
        eq(bankTransactions.status, "review"),
        isNull(books.archivedAt),
        ne(bookMembers.role, "viewer"),
        isNull(bankTransactions.duplicateOfId),
      ),
    );
  return {
    items: rows.map((r) => ({
      id: r.id,
      bookId: r.bookId,
      accountId: r.accountId,
      amountCents: r.amountCents,
      postedDate: r.postedDate,
    })),
    info: new Map(rows.map((r) => [r.id, { bookName: r.bookName, accountName: r.accountName }])),
  };
}

export type EntryBankContext = {
  bankTransactions: {
    id: string;
    accountName: string;
    postedDate: string;
    description: string;
    amountCents: number;
    postMethod: string | null;
  }[];
  /** The other side of a transfer between books, when this user can see that book. */
  partners: { entryId: string; entryNumber: number; bookId: string; bookName: string }[];
};

/** The bank transactions an entry records, and its partner entries in other books. */
export async function entryBankContext(
  db: DbOrTx,
  userId: string,
  bookId: string,
  entry: { id: string; transferGroupId: string | null },
): Promise<EntryBankContext> {
  const bank = await db
    .select({
      id: bankTransactions.id,
      accountName: accounts.name,
      postedDate: bankTransactions.postedDate,
      description: bankTransactions.description,
      amountCents: bankTransactions.amountCents,
      postMethod: bankTransactions.postMethod,
    })
    .from(bankTransactions)
    .innerJoin(accounts, eq(accounts.id, bankTransactions.accountId))
    .where(and(eq(bankTransactions.bookId, bookId), eq(bankTransactions.entryId, entry.id)))
    .orderBy(asc(bankTransactions.postedDate));
  const partners = entry.transferGroupId
    ? await db
        .select({
          entryId: journalEntries.id,
          entryNumber: journalEntries.entryNumber,
          bookId: books.id,
          bookName: books.name,
        })
        .from(journalEntries)
        .innerJoin(books, eq(books.id, journalEntries.bookId))
        .innerJoin(
          bookMembers,
          and(eq(bookMembers.bookId, books.id), eq(bookMembers.userId, userId)),
        )
        .where(
          and(
            eq(journalEntries.transferGroupId, entry.transferGroupId),
            ne(journalEntries.id, entry.id),
          ),
        )
    : [];
  return { bankTransactions: bank, partners };
}
