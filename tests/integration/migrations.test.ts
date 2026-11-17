import { describe, expect, it } from "vitest";
import { getDb, getPool } from "@/server/db/client";
import { appliedMigrationCount, runMigrations } from "@/server/db/migrate";
import { accounts, books } from "@/server/db/schema";
import { setupCleanDatabase } from "./helpers";

setupCleanDatabase();

async function makeBook(name = "Book") {
  const [b] = await getDb()
    .insert(books)
    .values({ name, template: "blank", startDate: "2026-01-01" })
    .returning();
  return b!;
}

async function expectSqlError(promise: Promise<unknown>, constraint: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, `expected ${constraint} to reject`).not.toBeNull();
  const cause = (err as { cause?: { constraint?: string } }).cause ?? err;
  expect((cause as { constraint?: string }).constraint).toBe(constraint);
}

describe("migrations", () => {
  it("have been applied and are safe to run again", async () => {
    const before = await appliedMigrationCount(getPool());
    expect(before).toBeGreaterThan(0);
    await runMigrations(getPool());
    expect(await appliedMigrationCount(getPool())).toBe(before);
  });

  it("create the expected tables with readable names", async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "accounts",
      "app_settings",
      "audit_log",
      "auth_accounts",
      "auth_sessions",
      "auth_verifications",
      "book_members",
      "books",
      "users",
    ]);
  });
});

describe("database-level guards on accounts", () => {
  it("rejects a parent account from a different book", async () => {
    const a = await makeBook("A");
    const b = await makeBook("B");
    const [parent] = await getDb()
      .insert(accounts)
      .values({ bookId: a.id, name: "Parent", type: "expense", subtype: "expense" })
      .returning();
    await expectSqlError(
      getDb().insert(accounts).values({
        bookId: b.id,
        parentAccountId: parent!.id,
        name: "Child",
        type: "expense",
        subtype: "expense",
      }),
      "accounts_parent_same_book_fk",
    );
  });

  it("rejects unknown types and detail types", async () => {
    const book = await makeBook();
    await expectSqlError(
      getDb()
        .insert(accounts)
        .values({ bookId: book.id, name: "X", type: "cash", subtype: "bank" }),
      "accounts_type_check",
    );
    await expectSqlError(
      getDb()
        .insert(accounts)
        .values({ bookId: book.id, name: "X", type: "asset", subtype: "piggy" }),
      "accounts_subtype_check",
    );
  });

  it("never lets a bucket parent accept postings", async () => {
    const book = await makeBook();
    await expectSqlError(
      getDb().insert(accounts).values({
        bookId: book.id,
        name: "Savings",
        type: "asset",
        subtype: "bank",
        bucketsEnabled: true,
        allowsPosting: true,
      }),
      "accounts_bucket_parent_no_posting",
    );
  });

  it("enforces unique account numbers and sibling names per book", async () => {
    const book = await makeBook();
    const other = await makeBook("Other");
    const base = { type: "expense", subtype: "expense" } as const;
    await getDb()
      .insert(accounts)
      .values({ ...base, bookId: book.id, name: "Rent", code: "6100" });
    await expectSqlError(
      getDb()
        .insert(accounts)
        .values({ ...base, bookId: book.id, name: "Lease", code: "6100" }),
      "accounts_book_code_key",
    );
    await expectSqlError(
      getDb()
        .insert(accounts)
        .values({ ...base, bookId: book.id, name: "RENT" }),
      "accounts_sibling_name_key",
    );
    // Same name and number are fine in a different book.
    await getDb()
      .insert(accounts)
      .values({ ...base, bookId: other.id, name: "Rent", code: "6100" });
  });

  it("allows only one account per system role in a book", async () => {
    const book = await makeBook();
    const obe = {
      bookId: book.id,
      type: "equity",
      subtype: "opening_balance",
      isSystem: true,
      systemRole: "opening_balance_equity",
    } as const;
    await getDb()
      .insert(accounts)
      .values({ ...obe, name: "Opening Balance Equity" });
    await expectSqlError(
      getDb()
        .insert(accounts)
        .values({ ...obe, name: "Second OBE" }),
      "accounts_book_system_role_key",
    );
  });
});
