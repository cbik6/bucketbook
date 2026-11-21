import { rm } from "node:fs/promises";
import path from "node:path";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { BOOK_TEMPLATES, type BookRole, type BookTemplate } from "@/lib/account-types";
import { isSyncEveryHours } from "@/lib/bank-sync";
import { insertTemplateAccounts } from "../accounts/service";
import { CHART_TEMPLATES } from "../accounts/templates";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import {
  accounts,
  attachments,
  simplefinConnections,
  bankRules,
  bankTransactions,
  bookCounterparts,
  bookMembers,
  books,
  bucketRules,
  budgets,
  csvPresets,
  journalEntries,
  journalEntryVersions,
  journalLines,
  loans,
  reconciliationItems,
  reconciliations,
} from "../db/schema";
import { getEnv } from "../env";
import { ForbiddenError, NotFoundError, UserFacingError } from "../errors";

export type BookRow = typeof books.$inferSelect;
export type BookWithRole = BookRow & { role: BookRole };

const bookName = z
  .string()
  .trim()
  .min(1, "Give the book a name.")
  .max(80, "Keep the book name under 80 characters.");

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date.")
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "That isn't a real date.")
  .refine((v) => v >= "1900-01-01" && v <= "2999-12-31", "Pick a date between 1900 and 2999.");

export const createBookSchema = z.object({
  name: bookName,
  template: z.enum(BOOK_TEMPLATES, { message: "Pick a starting chart of accounts." }),
  startDate: isoDate,
});

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UserFacingError(issue.message, issue.path.join("."));
  }
  return result.data;
}

const ROLE_RANK: Record<BookRole, number> = { viewer: 0, editor: 1, owner: 2 };

export async function createBook(
  db: Database,
  actor: { userId: string },
  raw: unknown,
): Promise<{ book: BookRow; accountCount: number }> {
  const input = parse(createBookSchema, raw);
  return db.transaction(async (tx) => {
    const [book] = await tx
      .insert(books)
      .values({ name: input.name, template: input.template, startDate: input.startDate })
      .returning();
    await tx.insert(bookMembers).values({ bookId: book!.id, userId: actor.userId, role: "owner" });
    await recordAudit(tx, {
      bookId: book!.id,
      userId: actor.userId,
      entityType: "book",
      entityId: book!.id,
      action: "create",
      after: book,
    });
    const accountCount = await insertTemplateAccounts(
      tx,
      actor,
      book!.id,
      CHART_TEMPLATES[input.template as BookTemplate],
    );
    return { book: book!, accountCount };
  });
}

export async function listBooksForUser(
  db: DbOrTx,
  userId: string,
  options: { includeArchived?: boolean } = {},
): Promise<BookWithRole[]> {
  const conditions = [eq(bookMembers.userId, userId)];
  if (!options.includeArchived) conditions.push(isNull(books.archivedAt));
  const rows = await db
    .select({ book: books, role: bookMembers.role })
    .from(books)
    .innerJoin(bookMembers, eq(bookMembers.bookId, books.id))
    .where(and(...conditions))
    .orderBy(asc(books.createdAt));
  return rows.map((r) => ({ ...r.book, role: r.role as BookRole }));
}

/** Returns the book if the user is a member with at least `minRole`, otherwise throws. */
export async function requireBookAccess(
  db: DbOrTx,
  userId: string,
  bookId: string,
  minRole: BookRole = "viewer",
): Promise<BookWithRole> {
  if (!z.uuid().safeParse(bookId).success) throw new NotFoundError("That book");
  const rows = await db
    .select({ book: books, role: bookMembers.role })
    .from(books)
    .innerJoin(bookMembers, eq(bookMembers.bookId, books.id))
    .where(and(eq(books.id, bookId), eq(bookMembers.userId, userId)))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("That book");
  const role = row.role as BookRole;
  if (ROLE_RANK[role] < ROLE_RANK[minRole]) throw new ForbiddenError();
  return { ...row.book, role };
}

export async function renameBook(
  db: Database,
  actor: { userId: string },
  bookId: string,
  rawName: unknown,
): Promise<BookRow> {
  const name = parse(bookName, rawName);
  return db.transaction(async (tx) => {
    const before = await requireBookAccess(tx, actor.userId, bookId, "owner");
    const [after] = await tx.update(books).set({ name }).where(eq(books.id, bookId)).returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "book",
      entityId: bookId,
      action: "update",
      before,
      after,
    });
    return after!;
  });
}

/**
 * Whether accounts with sub-accounts can take postings. When off, parents are
 * headings only: pickers grey them out and posting to one is refused. Entries
 * that already use a parent stay as they are.
 */
export async function setPostToParents(
  db: Database,
  actor: { userId: string },
  bookId: string,
  allowed: boolean,
): Promise<BookRow> {
  return db.transaction(async (tx) => {
    const before = await requireBookAccess(tx, actor.userId, bookId, "editor");
    const [after] = await tx
      .update(books)
      .set({ postToParents: allowed })
      .where(eq(books.id, bookId))
      .returning();
    if (before.postToParents !== allowed) {
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "book",
        entityId: bookId,
        action: "update",
        before: { postToParents: before.postToParents },
        after: { postToParents: allowed },
      });
    }
    return after!;
  });
}

/**
 * How often the book's bank connections sync, and the hour of the day's first
 * sync. Owners only, like connecting a bank. The caller updates the job schedules.
 */
export async function setBankSync(
  db: Database,
  actor: { userId: string },
  bookId: string,
  input: { everyHours: unknown; hour: unknown },
): Promise<BookRow> {
  const everyHours = Number(input.everyHours);
  const hour = Number(input.hour);
  if (!isSyncEveryHours(everyHours))
    throw new UserFacingError("Pick how often to sync.", "everyHours");
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new UserFacingError("Pick a time.", "hour");
  }
  return db.transaction(async (tx) => {
    const before = await requireBookAccess(tx, actor.userId, bookId, "owner");
    const [after] = await tx
      .update(books)
      .set({ bankSyncEveryHours: everyHours, bankSyncHour: hour })
      .where(eq(books.id, bookId))
      .returning();
    if (before.bankSyncEveryHours !== everyHours || before.bankSyncHour !== hour) {
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "book",
        entityId: bookId,
        action: "update",
        before: {
          bankSyncEveryHours: before.bankSyncEveryHours,
          bankSyncHour: before.bankSyncHour,
        },
        after: { bankSyncEveryHours: everyHours, bankSyncHour: hour },
      });
    }
    return after!;
  });
}

export async function setBookArchived(
  db: Database,
  actor: { userId: string },
  bookId: string,
  archive: boolean,
): Promise<BookRow> {
  return db.transaction(async (tx) => {
    const before = await requireBookAccess(tx, actor.userId, bookId, "owner");
    if (archive && before.archivedAt) throw new UserFacingError("That book is already archived.");
    if (!archive && !before.archivedAt) throw new UserFacingError("That book isn't archived.");
    const [after] = await tx
      .update(books)
      .set({ archivedAt: archive ? new Date() : null })
      .where(eq(books.id, bookId))
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "book",
      entityId: bookId,
      action: archive ? "archive" : "unarchive",
      before,
      after,
    });
    return after!;
  });
}

/**
 * Permanently deletes an archived book and everything in it: entries, accounts,
 * bank transactions, rules, reconciliations, receipts. Owners only, and only
 * once the book is archived, so it always takes two deliberate steps. Bank
 * accounts linked to it stay connected and go back to waiting for setup.
 *
 * The ledger guards refuse to delete posted history; this is the one place that
 * opens them, by naming this book in a transaction-local setting they check.
 */
export async function deleteBook(
  db: Database,
  actor: { userId: string },
  bookId: string,
  confirmName: unknown,
): Promise<{ name: string }> {
  const name = await db.transaction(async (tx) => {
    const book = await requireBookAccess(tx, actor.userId, bookId, "owner");
    if (!book.archivedAt) {
      throw new UserFacingError("Archive the book first. Only archived books can be deleted.");
    }
    if (typeof confirmName !== "string" || confirmName.trim() !== book.name) {
      throw new UserFacingError("Type the book's name exactly to delete it.", "confirmName");
    }
    // Lock the book row so nothing else writes to it while it is removed.
    await tx.execute(sql`select id from ${books} where ${books.id} = ${bookId} for update`);
    await tx.execute(sql`select set_config('bucketbook.deleting_book', ${bookId}, true)`);

    // The book's bank connections (and their accounts) go with it.
    await tx.delete(simplefinConnections).where(eq(simplefinConnections.bookId, bookId));
    await tx.delete(attachments).where(eq(attachments.bookId, bookId));
    await tx.delete(bankTransactions).where(eq(bankTransactions.bookId, bookId));
    const recs = tx
      .select({ id: reconciliations.id })
      .from(reconciliations)
      .where(eq(reconciliations.bookId, bookId));
    await tx.delete(reconciliationItems).where(inArray(reconciliationItems.reconciliationId, recs));
    await tx.delete(reconciliations).where(eq(reconciliations.bookId, bookId));
    await tx.delete(loans).where(eq(loans.bookId, bookId));
    await tx.delete(bucketRules).where(eq(bucketRules.bookId, bookId));
    await tx.delete(bankRules).where(eq(bankRules.bookId, bookId));
    await tx.delete(csvPresets).where(eq(csvPresets.bookId, bookId));
    await tx.delete(budgets).where(eq(budgets.bookId, bookId));
    await tx
      .delete(bookCounterparts)
      .where(or(eq(bookCounterparts.bookId, bookId), eq(bookCounterparts.otherBookId, bookId)));
    await tx.delete(journalLines).where(eq(journalLines.bookId, bookId));
    const entries = tx
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.bookId, bookId));
    await tx.delete(journalEntryVersions).where(inArray(journalEntryVersions.entryId, entries));
    await tx.delete(journalEntries).where(eq(journalEntries.bookId, bookId));
    await tx.delete(accounts).where(eq(accounts.bookId, bookId));
    await tx.delete(bookMembers).where(eq(bookMembers.bookId, bookId));
    await tx.delete(books).where(eq(books.id, bookId));

    await recordAudit(tx, {
      bookId: null,
      userId: actor.userId,
      entityType: "book",
      entityId: bookId,
      action: "delete",
      before: { name: book.name, startDate: book.startDate, template: book.template },
    });
    return book.name;
  });

  // Receipt files live outside the database; remove them once the rows are gone.
  const dir = path.join(path.resolve(getEnv().RECEIPTS_DIR), bookId);
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  return { name };
}
