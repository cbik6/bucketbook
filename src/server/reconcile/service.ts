import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { formatDay } from "@/lib/dates";
import { formatCents, parseCents } from "@/lib/money";
import { recordAudit } from "../audit/record";
import { requireBankableAccount } from "../bank/accounts";
import type { Database, DbOrTx } from "../db/client";
import { accounts, reconciliationItems, reconciliations } from "../db/schema";
import { NotFoundError, UserFacingError, pgErrorInfo } from "../errors";

type Actor = { userId: string };

export type ReconciliationRow = typeof reconciliations.$inferSelect;

/** Statement balances are typed the way the statement shows them; the ledger stores debits minus credits. */
const toLedger = (type: string, natural: number) => (type === "liability" ? -natural : natural);
export const toNatural = toLedger;

const startSchema = z.object({
  accountId: z.uuid("Pick an account."),
  statementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the statement's ending date."),
  statementBalance: z.string().trim().min(1, "Enter the statement's ending balance."),
});

async function lastFinished(db: DbOrTx, accountId: string) {
  const [row] = await db
    .select()
    .from(reconciliations)
    .where(and(eq(reconciliations.accountId, accountId), eq(reconciliations.status, "finished")))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.finishedAt))
    .limit(1);
  return row ?? null;
}

export async function startReconciliation(
  db: Database,
  actor: Actor,
  bookId: string,
  raw: unknown,
) {
  const parsed = startSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;
  let natural: number;
  try {
    natural = parseCents(input.statementBalance);
  } catch {
    throw new UserFacingError("Enter the balance like 1,234.56.", "statementBalance");
  }
  const account = await requireBankableAccount(db, bookId, input.accountId);
  const previous = await lastFinished(db, account.id);
  if (previous && input.statementDate < previous.statementDate) {
    throw new UserFacingError(
      `${account.name} is already reconciled through ${formatDay(previous.statementDate)}. Pick a later statement.`,
      "statementDate",
    );
  }
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reconciliations)
        .values({
          bookId,
          accountId: account.id,
          statementDate: input.statementDate,
          statementBalanceCents: toLedger(account.type, natural),
          beginningBalanceCents: previous?.statementBalanceCents ?? 0,
          createdBy: actor.userId,
        })
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "reconciliation",
        entityId: row!.id,
        action: "create",
        after: {
          accountId: account.id,
          statementDate: input.statementDate,
          accountName: account.name,
        },
      });
      return row!;
    });
  } catch (err) {
    if (pgErrorInfo(err).constraint === "reconciliations_one_open_key") {
      throw new UserFacingError(`${account.name} already has a reconciliation in progress.`);
    }
    throw err;
  }
}

async function loadRec(db: DbOrTx, bookId: string, recId: string) {
  if (!z.uuid().safeParse(recId).success) throw new NotFoundError("That reconciliation");
  const [row] = await db
    .select()
    .from(reconciliations)
    .where(and(eq(reconciliations.id, recId), eq(reconciliations.bookId, bookId)));
  if (!row) throw new NotFoundError("That reconciliation");
  return row;
}

export type RecItem = {
  entryId: string;
  entryNumber: number;
  entryKind: string;
  entryDate: string;
  description: string;
  /** Debits minus credits on the account (and its buckets) in this entry. */
  amountCents: number;
  cleared: boolean;
};

/**
 * Entries that touch the account (or its buckets) up to the statement date
 * and aren't cleared on another statement yet, plus the ones cleared here.
 */
async function candidates(db: DbOrTx, rec: ReconciliationRow): Promise<RecItem[]> {
  const result = await db.execute<{
    entry_id: string;
    entry_number: number;
    entry_kind: string;
    entry_date: string;
    entry_payee: string | null;
    entry_memo: string | null;
    net: string;
    cleared_here: boolean;
  }>(sql`
    select l.entry_id, l.entry_number, l.entry_kind, l.entry_date::text as entry_date, l.entry_payee, l.entry_memo,
           sum(l.net_cents)::text as net,
           exists (select 1 from reconciliation_items i
                   where i.reconciliation_id = ${rec.id} and i.entry_id = l.entry_id) as cleared_here
    from ledger_lines l
    join accounts a on a.id = l.account_id
    where l.book_id = ${rec.bookId}
      and (a.id = ${rec.accountId} or (a.parent_account_id = ${rec.accountId} and a.is_bucket))
      and not exists (
        select 1 from reconciliation_items i
        where i.entry_id = l.entry_id and i.account_id = ${rec.accountId}
          and i.reconciliation_id <> ${rec.id}
      )
    group by l.entry_id, l.entry_number, l.entry_kind, l.entry_date, l.entry_payee, l.entry_memo
    having sum(l.net_cents) <> 0
       and (min(l.entry_date) <= ${rec.statementDate}
            or exists (select 1 from reconciliation_items i
                       where i.reconciliation_id = ${rec.id} and i.entry_id = l.entry_id))
    order by l.entry_date, l.entry_number
  `);
  return result.rows.map((r) => ({
    entryId: r.entry_id,
    entryNumber: Number(r.entry_number),
    entryKind: r.entry_kind,
    entryDate: r.entry_date,
    description: r.entry_payee || r.entry_memo || "Journal entry",
    amountCents: Number(r.net),
    cleared: Boolean(r.cleared_here),
  }));
}

export async function reconciliationState(db: DbOrTx, bookId: string, recId: string) {
  const rec = await loadRec(db, bookId, recId);
  const [account] = await db.select().from(accounts).where(eq(accounts.id, rec.accountId));
  let items: RecItem[];
  if (rec.status === "finished") {
    const rows = await db.execute<{
      entry_id: string;
      entry_number: number;
      kind: string;
      entry_date: string;
      payee: string | null;
      memo: string | null;
      amount_cents: string;
    }>(sql`
      select i.entry_id, e.entry_number, e.kind, e.entry_date::text as entry_date, e.payee, e.memo,
             i.amount_cents::text as amount_cents
      from reconciliation_items i join journal_entries e on e.id = i.entry_id
      where i.reconciliation_id = ${rec.id}
      order by e.entry_date, e.entry_number
    `);
    items = rows.rows.map((r) => ({
      entryId: r.entry_id,
      entryNumber: Number(r.entry_number),
      entryKind: r.kind,
      entryDate: r.entry_date,
      description: r.payee || r.memo || "Journal entry",
      amountCents: Number(r.amount_cents),
      cleared: true,
    }));
  } else {
    items = await candidates(db, rec);
  }
  const clearedCents =
    rec.beginningBalanceCents +
    items.filter((i) => i.cleared).reduce((n, i) => n + i.amountCents, 0);
  return {
    rec,
    account: account!,
    items,
    clearedCents,
    differenceCents: rec.statementBalanceCents - clearedCents,
  };
}

export async function setCleared(
  db: Database,
  bookId: string,
  recId: string,
  entryIds: string[],
  cleared: boolean,
) {
  return db.transaction(async (tx) => {
    const rec = await loadRec(tx, bookId, recId);
    if (rec.status !== "open") throw new UserFacingError("This reconciliation is finished.");
    const wanted = new Set(entryIds);
    if (!cleared) {
      if (wanted.size) {
        await tx
          .delete(reconciliationItems)
          .where(
            and(
              eq(reconciliationItems.reconciliationId, rec.id),
              inArray(reconciliationItems.entryId, [...wanted]),
            ),
          );
      }
      return;
    }
    const available = (await candidates(tx, rec)).filter(
      (c) => wanted.has(c.entryId) && !c.cleared,
    );
    if (available.length) {
      await tx
        .insert(reconciliationItems)
        .values(
          available.map((c) => ({
            reconciliationId: rec.id,
            entryId: c.entryId,
            accountId: rec.accountId,
            amountCents: c.amountCents,
          })),
        )
        .onConflictDoNothing();
    }
  });
}

export async function finishReconciliation(
  db: Database,
  actor: Actor,
  bookId: string,
  recId: string,
) {
  return db.transaction(async (tx) => {
    const rec = await loadRec(tx, bookId, recId);
    if (rec.status !== "open")
      throw new UserFacingError("This reconciliation is already finished.");
    // Amounts are re-read now, in case an entry changed after it was checked off.
    const current = await candidates(tx, rec);
    for (const c of current.filter((x) => x.cleared)) {
      await tx
        .update(reconciliationItems)
        .set({ amountCents: c.amountCents })
        .where(
          and(
            eq(reconciliationItems.reconciliationId, rec.id),
            eq(reconciliationItems.entryId, c.entryId),
          ),
        );
    }
    const cleared = current.filter((c) => c.cleared).reduce((n, c) => n + c.amountCents, 0);
    const difference = rec.statementBalanceCents - (rec.beginningBalanceCents + cleared);
    if (difference !== 0) {
      throw new UserFacingError(
        `The cleared balance is ${formatCents(Math.abs(difference))} ${difference > 0 ? "below" : "above"} the statement. Check off or uncheck items until the difference is zero.`,
      );
    }
    await tx
      .update(reconciliations)
      .set({ status: "finished", finishedAt: new Date() })
      .where(eq(reconciliations.id, rec.id));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "reconciliation",
      entityId: rec.id,
      action: "update",
      after: {
        finished: true,
        statementDate: rec.statementDate,
        items: current.filter((c) => c.cleared).length,
      },
    });
  });
}

/** Deletes a reconciliation that isn't finished. */
export async function discardReconciliation(
  db: Database,
  actor: Actor,
  bookId: string,
  recId: string,
) {
  const rec = await loadRec(db, bookId, recId);
  if (rec.status !== "open")
    throw new UserFacingError("Finished reconciliations can only be undone.");
  await db.transaction(async (tx) => {
    await tx.delete(reconciliations).where(eq(reconciliations.id, rec.id));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "reconciliation",
      entityId: rec.id,
      action: "delete",
      before: { statementDate: rec.statementDate },
    });
  });
}

/** Reopens the most recent finished reconciliation of an account. */
export async function undoReconciliation(
  db: Database,
  actor: Actor,
  bookId: string,
  recId: string,
) {
  return db.transaction(async (tx) => {
    const rec = await loadRec(tx, bookId, recId);
    const latest = await lastFinished(tx, rec.accountId);
    if (rec.status !== "finished" || latest?.id !== rec.id) {
      throw new UserFacingError("Only the most recent finished reconciliation can be undone.");
    }
    const [open] = await tx
      .select({ id: reconciliations.id })
      .from(reconciliations)
      .where(and(eq(reconciliations.accountId, rec.accountId), eq(reconciliations.status, "open")));
    if (open) throw new UserFacingError("Finish or discard the reconciliation in progress first.");
    await tx
      .update(reconciliations)
      .set({ status: "open", finishedAt: null })
      .where(eq(reconciliations.id, rec.id));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "reconciliation",
      entityId: rec.id,
      action: "update",
      after: { reopened: true, statementDate: rec.statementDate },
    });
  });
}

export async function listReconciliations(db: DbOrTx, bookId: string) {
  return db
    .select({
      rec: reconciliations,
      accountName: accounts.name,
      accountType: accounts.type,
    })
    .from(reconciliations)
    .innerJoin(accounts, eq(accounts.id, reconciliations.accountId))
    .where(eq(reconciliations.bookId, bookId))
    .orderBy(desc(reconciliations.statementDate), desc(reconciliations.createdAt));
}

/**
 * Finished reconciliations an entry belongs to. Editing or reversing such an
 * entry changes a balance you already matched to a statement.
 */
export async function reconciledStatements(db: DbOrTx, entryId: string) {
  return db
    .select({
      statementDate: reconciliations.statementDate,
      accountName: accounts.name,
    })
    .from(reconciliationItems)
    .innerJoin(reconciliations, eq(reconciliations.id, reconciliationItems.reconciliationId))
    .innerJoin(accounts, eq(accounts.id, reconciliations.accountId))
    .where(and(eq(reconciliationItems.entryId, entryId), eq(reconciliations.status, "finished")));
}

/** Throws unless the caller confirmed changing a reconciled entry. */
export async function assertReconciledChangeConfirmed(
  db: DbOrTx,
  entryId: string,
  confirmed: boolean,
) {
  if (confirmed) return;
  const statements = await reconciledStatements(db, entryId);
  if (statements.length === 0) return;
  const s = statements[0]!;
  throw new UserFacingError(
    `This entry was reconciled on the ${s.accountName} statement ending ${formatDay(s.statementDate)}. Changing it changes a balance that already matched the bank. Tick the box to go ahead.`,
    "confirmReconciled",
  );
}
