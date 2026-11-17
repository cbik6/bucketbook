import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { BOOK_TEMPLATES, type BookRole, type BookTemplate } from "@/lib/account-types";
import { insertTemplateAccounts } from "../accounts/service";
import { CHART_TEMPLATES } from "../accounts/templates";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { bookMembers, books } from "../db/schema";
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
