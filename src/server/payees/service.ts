import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { storeKey } from "@/lib/category-learner";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { accounts, journalEntries, payeeMatches, payees } from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";

/**
 * Payees: who money goes to or comes from. Each book keeps a list; entries link
 * to a payee and also keep its name as text, so every screen that shows an
 * entry's payee keeps working, and renaming or merging updates them all.
 *
 * Payees are made on purpose: typing a name on a journal entry, adding one in
 * review under any name but the bank's raw description (the bank's own payee
 * field counts), or adding one on the Payees page. Raw descriptions stay plain
 * text, so the list stays clean.
 */

type Actor = { userId: string };

export const PAYEE_NAME_MAX = 200;

export type PayeeRef = { id: string; name: string; defaultAccountId: string | null };

/** Collapses spaces, so "Taco  Bell " and "Taco Bell" are one payee. */
export const cleanPayeeName = (name: string) => name.replace(/\s+/g, " ").trim();

const payeeNameSchema = z
  .string()
  .transform(cleanPayeeName)
  .pipe(
    z
      .string()
      .min(1, "Enter the payee's name.")
      .max(PAYEE_NAME_MAX, `Keep the name under ${PAYEE_NAME_MAX} characters.`),
  );

const refColumns = {
  id: payees.id,
  name: payees.name,
  defaultAccountId: payees.defaultAccountId,
};

async function findByName(tx: DbOrTx, bookId: string, name: string) {
  const [row] = await tx
    .select({ ...refColumns, archivedAt: payees.archivedAt })
    .from(payees)
    .where(and(eq(payees.bookId, bookId), sql`lower(${payees.name}) = lower(${name})`));
  return row ?? null;
}

/**
 * The payee an entry's payee text stands for. An existing payee (archived or
 * not) is always linked; a new one is only made when `create` is set, which
 * is what saving an entry or a review approval does with a name you chose.
 */
export async function resolvePayee(
  tx: DbOrTx,
  bookId: string,
  text: string | null | undefined,
  options: { create: boolean },
): Promise<PayeeRef | null> {
  const name = cleanPayeeName(text ?? "");
  if (!name || name.length > PAYEE_NAME_MAX) return null;
  const found = await findByName(tx, bookId, name);
  if (found) {
    // Using an archived payee again brings it back to the list.
    if (found.archivedAt && options.create) {
      await tx.update(payees).set({ archivedAt: null }).where(eq(payees.id, found.id));
    }
    return { id: found.id, name: found.name, defaultAccountId: found.defaultAccountId };
  }
  if (!options.create) return null;
  await tx.insert(payees).values({ bookId, name }).onConflictDoNothing();
  const made = await findByName(tx, bookId, name);
  return made ? { id: made.id, name: made.name, defaultAccountId: made.defaultAccountId } : null;
}

/** The key a bank description is matched on: the store name the category learner uses. */
export const payeeMatchKey = (bankText: string) => storeKey(bankText);

/** Remembers that this bank text means this payee, for the next transaction like it. */
export async function learnPayeeMatch(
  tx: DbOrTx,
  bookId: string,
  bankText: string,
  payeeId: string,
) {
  const key = payeeMatchKey(bankText);
  if (!key) return;
  const sample = bankText.replace(/\s+/g, " ").trim().slice(0, 200);
  await tx
    .insert(payeeMatches)
    .values({ bookId, key, payeeId, sample })
    .onConflictDoUpdate({
      target: [payeeMatches.bookId, payeeMatches.key],
      set: { payeeId, sample },
    });
}

/** For each bank text, the payee it was learned to mean (archived payees left out). */
export async function payeesForBankText(
  db: DbOrTx,
  bookId: string,
  texts: string[],
): Promise<Map<string, PayeeRef>> {
  const keys = [...new Set(texts.map(payeeMatchKey).filter(Boolean))];
  const out = new Map<string, PayeeRef>();
  if (keys.length === 0) return out;
  const rows = await db
    .select({ key: payeeMatches.key, ...refColumns })
    .from(payeeMatches)
    .innerJoin(payees, eq(payees.id, payeeMatches.payeeId))
    .where(
      and(
        eq(payeeMatches.bookId, bookId),
        inArray(payeeMatches.key, keys),
        isNull(payees.archivedAt),
      ),
    );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  for (const text of texts) {
    const r = byKey.get(payeeMatchKey(text));
    if (r) out.set(text, { id: r.id, name: r.name, defaultAccountId: r.defaultAccountId });
  }
  return out;
}

/** The payee list for pickers: names in order, archived ones left out. */
export async function payeeChoices(db: DbOrTx, bookId: string): Promise<PayeeRef[]> {
  return db
    .select(refColumns)
    .from(payees)
    .where(and(eq(payees.bookId, bookId), isNull(payees.archivedAt)))
    .orderBy(asc(sql`lower(${payees.name})`));
}

/** One payee's name, for a page filtered to it; null when it isn't in this book. */
export async function payeeName(db: DbOrTx, bookId: string, payeeId: string) {
  if (!z.uuid().safeParse(payeeId).success) return null;
  const [row] = await db
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(and(eq(payees.id, payeeId), eq(payees.bookId, bookId)));
  return row ?? null;
}

/** Gives a payee its first category, when it has none yet. */
export async function setDefaultIfMissing(tx: DbOrTx, payeeId: string, accountId: string) {
  await tx
    .update(payees)
    .set({ defaultAccountId: accountId })
    .where(and(eq(payees.id, payeeId), isNull(payees.defaultAccountId)));
}

export type PayeeRow = {
  id: string;
  name: string;
  defaultAccountId: string | null;
  archived: boolean;
  entryCount: number;
  lastUsed: string | null;
  /** Spent on expense accounts (refunds subtract), all time. */
  spentCents: number;
  /** Bank text learned for it. */
  matches: { key: string; sample: string | null }[];
};

/** The Payees page: every payee with how often and how much it's used. */
export async function listPayees(db: DbOrTx, bookId: string): Promise<PayeeRow[]> {
  const result = await db.execute<{
    id: string;
    name: string;
    default_account_id: string | null;
    archived: boolean;
    entry_count: number;
    last_used: string | null;
    spent: string;
  }>(sql`
    select p.id, p.name, p.default_account_id, p.archived_at is not null as archived,
           (select count(*)::int from journal_entries e
             where e.payee_id = p.id and e.kind <> 'reversal'
               and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)) as entry_count,
           (select max(e.entry_date)::text from journal_entries e
             where e.payee_id = p.id and e.kind <> 'reversal') as last_used,
           coalesce((select sum(l.net_cents) from ledger_lines l
             join journal_entries e on e.id = l.entry_id
             join accounts a on a.id = l.account_id
             where e.payee_id = p.id and a.type = 'expense' and e.kind <> 'reversal'
               and not exists (select 1 from journal_entries r where r.reverses_entry_id = e.id)), 0)::text as spent
    from payees p
    where p.book_id = ${bookId}
    order by lower(p.name)
  `);
  const matches = await db
    .select({ payeeId: payeeMatches.payeeId, key: payeeMatches.key, sample: payeeMatches.sample })
    .from(payeeMatches)
    .where(eq(payeeMatches.bookId, bookId))
    .orderBy(asc(payeeMatches.key));
  const byPayee = new Map<string, { key: string; sample: string | null }[]>();
  for (const m of matches) {
    const list = byPayee.get(m.payeeId) ?? [];
    list.push({ key: m.key, sample: m.sample });
    byPayee.set(m.payeeId, list);
  }
  return result.rows.map((r) => ({
    id: r.id,
    name: r.name,
    defaultAccountId: r.default_account_id,
    archived: Boolean(r.archived),
    entryCount: Number(r.entry_count),
    lastUsed: r.last_used,
    spentCents: Number(r.spent),
    matches: byPayee.get(r.id) ?? [],
  }));
}

async function loadPayee(tx: DbOrTx, bookId: string, payeeId: string) {
  if (!z.uuid().safeParse(payeeId).success) throw new NotFoundError("That payee");
  const result = await tx.execute<{ id: string }>(
    sql`select id from payees where id = ${payeeId} and book_id = ${bookId} for update`,
  );
  if (!result.rows[0]) throw new NotFoundError("That payee");
  const [row] = await tx.select().from(payees).where(eq(payees.id, payeeId));
  return row!;
}

/** A category for a payee: an account in this book that takes postings. */
async function checkDefaultAccount(tx: DbOrTx, bookId: string, accountId: string | null) {
  if (!accountId) return null;
  if (!z.uuid().safeParse(accountId).success) {
    throw new UserFacingError("Pick a category from the list.", "defaultAccountId");
  }
  const [a] = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      allowsPosting: accounts.allowsPosting,
      archivedAt: accounts.archivedAt,
    })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.bookId, bookId)));
  if (!a) throw new UserFacingError("That category isn't in this book.", "defaultAccountId");
  if (!a.allowsPosting) {
    throw new UserFacingError(
      `${a.name} is a parent or holds buckets. Pick one under it.`,
      "defaultAccountId",
    );
  }
  if (a.archivedAt) throw new UserFacingError(`${a.name} is archived.`, "defaultAccountId");
  return a.id;
}

async function assertNameFree(tx: DbOrTx, bookId: string, name: string, exceptId?: string) {
  const [taken] = await tx
    .select({ id: payees.id, name: payees.name })
    .from(payees)
    .where(
      and(
        eq(payees.bookId, bookId),
        sql`lower(${payees.name}) = lower(${name})`,
        exceptId ? ne(payees.id, exceptId) : sql`true`,
      ),
    );
  if (taken) {
    throw new UserFacingError(
      exceptId
        ? `There's already a payee named ${taken.name}. To make them one, merge this payee into it.`
        : `There's already a payee named ${taken.name}.`,
      "name",
    );
  }
}

const createSchema = z.object({
  name: payeeNameSchema,
  defaultAccountId: z.string().nullish(),
});

export async function createPayee(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UserFacingError(
      parsed.error.issues[0]!.message,
      String(parsed.error.issues[0]!.path[0] ?? ""),
    );
  }
  const input = parsed.data;
  return db.transaction(async (tx) => {
    await assertNameFree(tx, bookId, input.name);
    const defaultAccountId = await checkDefaultAccount(tx, bookId, input.defaultAccountId || null);
    const [row] = await tx
      .insert(payees)
      .values({ bookId, name: input.name, defaultAccountId })
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "payee",
      entityId: row!.id,
      action: "create",
      after: { name: row!.name, defaultAccountId },
    });
    return row!;
  });
}

const updateSchema = z.object({
  name: payeeNameSchema.optional(),
  defaultAccountId: z.string().nullish(),
  archived: z.boolean().optional(),
});

/** Renames a payee (every entry using it shows the new name), sets its category, or archives it. */
export async function updatePayee(
  db: Database,
  actor: Actor,
  bookId: string,
  payeeId: string,
  raw: unknown,
) {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) {
    throw new UserFacingError(
      parsed.error.issues[0]!.message,
      String(parsed.error.issues[0]!.path[0] ?? ""),
    );
  }
  const input = parsed.data;
  return db.transaction(async (tx) => {
    const before = await loadPayee(tx, bookId, payeeId);
    const set: Partial<typeof payees.$inferInsert> = {};
    if (input.name !== undefined && input.name !== before.name) {
      await assertNameFree(tx, bookId, input.name, payeeId);
      set.name = input.name;
    }
    if (input.defaultAccountId !== undefined) {
      const id = await checkDefaultAccount(tx, bookId, input.defaultAccountId || null);
      if (id !== before.defaultAccountId) set.defaultAccountId = id;
    }
    if (input.archived !== undefined && input.archived !== Boolean(before.archivedAt)) {
      set.archivedAt = input.archived ? new Date() : null;
    }
    if (Object.keys(set).length === 0) return before;
    const [after] = await tx.update(payees).set(set).where(eq(payees.id, payeeId)).returning();
    if (set.name) {
      await tx
        .update(journalEntries)
        .set({ payee: set.name })
        .where(eq(journalEntries.payeeId, payeeId));
    }
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "payee",
      entityId: payeeId,
      action: "update",
      before: {
        name: before.name,
        defaultAccountId: before.defaultAccountId,
        archived: Boolean(before.archivedAt),
      },
      after: {
        name: after!.name,
        defaultAccountId: after!.defaultAccountId,
        archived: Boolean(after!.archivedAt),
      },
    });
    return after!;
  });
}

/**
 * Merges one payee into another: its entries and bank text move over, it
 * takes the other's category if that has none, and it's removed.
 */
export async function mergePayees(
  db: Database,
  actor: Actor,
  bookId: string,
  fromId: string,
  intoId: string,
) {
  if (fromId === intoId) throw new UserFacingError("Pick a different payee to merge into.", "into");
  return db.transaction(async (tx) => {
    const [first, second] = [fromId, intoId].sort();
    const locked = new Map([
      [first!, await loadPayee(tx, bookId, first!)],
      [second!, await loadPayee(tx, bookId, second!)],
    ]);
    const from = locked.get(fromId)!;
    const into = locked.get(intoId)!;
    const moved = await tx
      .update(journalEntries)
      .set({ payeeId: into.id, payee: into.name })
      .where(eq(journalEntries.payeeId, from.id))
      .returning({ id: journalEntries.id });
    await tx
      .update(payeeMatches)
      .set({ payeeId: into.id })
      .where(eq(payeeMatches.payeeId, from.id));
    if (!into.defaultAccountId && from.defaultAccountId) {
      await tx
        .update(payees)
        .set({ defaultAccountId: from.defaultAccountId })
        .where(eq(payees.id, into.id));
    }
    if (into.archivedAt && !from.archivedAt) {
      await tx.update(payees).set({ archivedAt: null }).where(eq(payees.id, into.id));
    }
    await tx.delete(payees).where(eq(payees.id, from.id));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "payee",
      entityId: into.id,
      action: "update",
      before: { name: from.name },
      after: { name: into.name, mergedFrom: from.name, entries: moved.length },
    });
    return { entries: moved.length };
  });
}

/** Forgets that a bank text means a payee. */
export async function removePayeeMatch(
  db: Database,
  actor: Actor,
  bookId: string,
  payeeId: string,
  key: string,
) {
  return db.transaction(async (tx) => {
    const payee = await loadPayee(tx, bookId, payeeId);
    const removed = await tx
      .delete(payeeMatches)
      .where(
        and(
          eq(payeeMatches.bookId, bookId),
          eq(payeeMatches.payeeId, payeeId),
          eq(payeeMatches.key, key),
        ),
      )
      .returning();
    if (removed.length === 0) return;
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "payee",
      entityId: payeeId,
      action: "update",
      before: { name: payee.name, match: removed[0]!.sample ?? key },
      after: { name: payee.name, match: null },
    });
  });
}
