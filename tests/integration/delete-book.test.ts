import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

// Receipts for this file go to a throwaway folder.
const receipts = mkdtempSync(path.join(tmpdir(), "bucketbook-receipts-"));
process.env.RECEIPTS_DIR = receipts;

const { saveAttachment } = await import("@/server/bank/attachments-service");
const { createBook, deleteBook, setBookArchived } = await import("@/server/books/service");
const { getDb } = await import("@/server/db/client");
const { bankFeeds, bookMembers, journalEntries, simplefinConnections } =
  await import("@/server/db/schema");
const { createDemoBook } = await import("@/server/demo/seed");
const { makeUser, setupCleanDatabase } = await import("./helpers");

setupCleanDatabase();

const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d49444154789c636001000000050001a5f645400000000049454e44ae426082",
  "hex",
);

/** Asserts the database refused, matching the Postgres message under Drizzle's wrapper. */
async function expectDbError(run: () => Promise<unknown>, message: RegExp) {
  const err = await run().then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, "expected the database to refuse").not.toBeNull();
  const text = String(
    (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message,
  );
  expect(text).toMatch(message);
}

/** Rows still pointing at the book, in every table that can. */
async function leftovers(bookId: string) {
  const tables = [
    "accounts",
    "journal_entries",
    "journal_lines",
    "bank_transactions",
    "bank_rules",
    "bucket_rules",
    "budgets",
    "loans",
    "reconciliations",
    "attachments",
    "book_members",
    "csv_presets",
    "book_counterparts",
    "books",
  ];
  const counts: Record<string, number> = {};
  for (const t of tables) {
    const col = t === "books" ? "id" : "book_id";
    const r = await getDb().execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(t)} where ${sql.identifier(col)} = ${bookId}`,
    );
    counts[t] = r.rows[0]!.n;
  }
  const versions = await getDb().execute<{ n: number }>(sql`
    select count(*)::int as n from journal_entry_versions v
    where not exists (select 1 from journal_entries e where e.id = v.entry_id)
  `);
  counts.orphan_versions = versions.rows[0]!.n;
  return counts;
}

describe("deleting a book", () => {
  it("removes an archived book and everything in it, and frees its bank feeds", async () => {
    const user = await makeUser();
    const actor = { userId: user.id };
    const { bookId } = await createDemoBook(getDb(), actor, "2026-11-18");
    const { book: other } = await createBook(getDb(), actor, {
      name: "Other",
      template: "blank",
      startDate: "2026-11-18",
    });

    const [entry] = await getDb()
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(eq(journalEntries.bookId, bookId))
      .limit(1);
    await saveAttachment(
      getDb(),
      actor,
      bookId,
      { entryId: entry!.id },
      {
        name: "receipt.png",
        bytes: PNG,
      },
    );
    expect(existsSync(path.join(receipts, bookId))).toBe(true);

    const [account] = await getDb()
      .execute<{ id: string }>(
        sql`
      select id from accounts where book_id = ${bookId} and allows_posting and type = 'asset' limit 1
    `,
      )
      .then((r) => r.rows);
    const [conn] = await getDb()
      .insert(simplefinConnections)
      .values({ bookId, label: "Bank", accessUrlCiphertext: "x" })
      .returning();
    const [feed] = await getDb()
      .insert(bankFeeds)
      .values({
        connectionId: conn!.id,
        externalId: "acct-1",
        name: "Checking",
        currency: "USD",
        bookId,
        accountId: account!.id,
        importFrom: "2026-11-18",
        syncedFrom: "2026-11-18",
        syncedThrough: "2026-11-18",
      })
      .returning();

    await setBookArchived(getDb(), actor, bookId, true);
    await expect(deleteBook(getDb(), actor, bookId, "Wrong name")).rejects.toThrow(/name/);
    const { name } = await deleteBook(getDb(), actor, bookId, "Demo Household");
    expect(name).toBe("Demo Household");

    const counts = await leftovers(bookId);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(existsSync(path.join(receipts, bookId))).toBe(false);

    // The book's bank connection and its accounts go with it.
    expect(await getDb().select().from(bankFeeds).where(eq(bankFeeds.id, feed!.id))).toEqual([]);
    expect(
      await getDb()
        .select()
        .from(simplefinConnections)
        .where(eq(simplefinConnections.id, conn!.id)),
    ).toEqual([]);

    // The other book is untouched and the ledger still balances there.
    const otherCounts = await leftovers(other.id);
    expect(otherCounts.books).toBe(1);
    expect(otherCounts.accounts).toBeGreaterThan(0);

    const audit = await getDb().execute<{ action: string }>(sql`
      select action from audit_log where entity_type = 'book' and entity_id = ${bookId} and action = 'delete'
    `);
    expect(audit.rows).toHaveLength(1);
  });

  it("refuses an active book and anyone but an owner", async () => {
    const owner = await makeUser();
    const editor = await makeUser("Editor");
    const { book } = await createBook(
      getDb(),
      { userId: owner.id },
      {
        name: "Family",
        template: "household",
        startDate: "2026-11-18",
      },
    );
    await expect(deleteBook(getDb(), { userId: owner.id }, book.id, "Family")).rejects.toThrow(
      /Archive the book first/,
    );
    await getDb()
      .insert(bookMembers)
      .values({ bookId: book.id, userId: editor.id, role: "editor" });
    await setBookArchived(getDb(), { userId: owner.id }, book.id, true);
    await expect(deleteBook(getDb(), { userId: editor.id }, book.id, "Family")).rejects.toThrow();
    expect((await leftovers(book.id)).books).toBe(1);
  });

  it("still blocks deleting ledger history any other way", async () => {
    const user = await makeUser();
    const { bookId } = await createDemoBook(getDb(), { userId: user.id }, "2026-11-18");
    const { book: other } = await createBook(
      getDb(),
      { userId: user.id },
      {
        name: "Other",
        template: "blank",
        startDate: "2026-11-18",
      },
    );
    await expectDbError(
      () => getDb().execute(sql`delete from journal_lines where book_id = ${bookId}`),
      /cannot be deleted/,
    );
    await expectDbError(
      () => getDb().execute(sql`delete from journal_entries where book_id = ${bookId}`),
      /cannot be deleted/,
    );

    // Naming a different book does not open this one.
    await expectDbError(
      () =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql`select set_config('bucketbook.deleting_book', ${other.id}, true)`);
          await tx.execute(sql`delete from journal_lines where book_id = ${bookId}`);
        }),
      /cannot be deleted/,
    );
    await expectDbError(
      () =>
        getDb().transaction(async (tx) => {
          await tx.execute(sql`select set_config('bucketbook.deleting_book', ${other.id}, true)`);
          await tx.execute(sql`
          delete from journal_entry_versions
          where entry_id in (select id from journal_entries where book_id = ${bookId})
        `);
        }),
      /history/,
    );
    expect((await leftovers(bookId)).journal_lines).toBeGreaterThan(0);
  });
});
