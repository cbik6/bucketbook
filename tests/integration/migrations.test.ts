import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAccounts } from "@/server/accounts/service";
import { createBook } from "@/server/books/service";
import { getDb, getPool } from "@/server/db/client";
import { appliedMigrationCount, runMigrations } from "@/server/db/migrate";
import { accounts, books, journalEntries, openingBalances } from "@/server/db/schema";
import { accountNetCents } from "@/server/ledger/queries";
import { createEntry, keepOpeningBalances } from "@/server/ledger/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

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
  it("0017 anchors an existing opening entry without changing any balance", async () => {
    const user = await makeUser();
    const actor = { userId: user.id };
    const { book } = await createBook(getDb(), actor, {
      name: "Before anchors",
      template: "household",
      startDate: "2026-11-17",
    });
    await addMoneyAccounts(actor, book.id, "household");
    const list = await listAccounts(getDb(), book.id);
    const id = (name: string) => list.find((a) => a.name === name)!.id;
    const obe = list.find((a) => a.systemRole === "opening_balance_equity")!.id;
    // One opening entry on the start date, the way 1.0.2 and earlier saved them.
    const entry = await getDb().transaction((tx) =>
      createEntry(tx, {
        actor,
        bookId: book.id,
        kind: "opening_balance",
        entryDate: "2026-11-17",
        memo: "Opening balances",
        changeNote: "Created",
        skipOpeningSync: true,
        lines: [
          { accountId: id("Checking"), debitCents: 100000, creditCents: 0, memo: null },
          { accountId: id("Credit Card"), debitCents: 0, creditCents: 20000, memo: null },
          { accountId: obe, debitCents: 0, creditCents: 80000, memo: null },
        ],
      }),
    );

    // Run the migration's fill-in statements.
    const sqlText = readFileSync("drizzle/0017_opening_anchors.sql", "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.includes('INSERT INTO "opening_balances"')) await getPool().query(statement);
    }
    const anchors = await getDb()
      .select()
      .from(openingBalances)
      .where(eq(openingBalances.bookId, book.id));
    expect(anchors.map((a) => [a.accountId, a.asOf, a.balanceCents]).sort()).toEqual(
      [
        [id("Checking"), "2026-11-17", 100000],
        [id("Credit Card"), "2026-11-17", 20000],
      ].sort(),
    );

    // Keeping the anchors changes nothing: same entry, same version, same balances.
    await getDb().transaction((tx) => keepOpeningBalances(tx, actor, book.id));
    const [after] = await getDb()
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, entry.id));
    expect(after!.currentVersion).toBe(1);
    expect(await accountNetCents(getDb(), id("Checking"))).toBe(100000);
    expect(await accountNetCents(getDb(), id("Credit Card"))).toBe(-20000);
  });

  it("have been applied and are safe to run again", async () => {
    const before = await appliedMigrationCount(getPool());
    expect(before).toBeGreaterThan(0);
    await runMigrations(getPool());
    expect(await appliedMigrationCount(getPool())).toBe(before);
  });

  it("create the expected tables with readable names", async () => {
    const { rows } = await getPool().query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`,
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      "accounts",
      "app_settings",
      "attachments",
      "audit_log",
      "auth_accounts",
      "auth_sessions",
      "auth_verifications",
      "bank_feeds",
      "bank_rules",
      "bank_transactions",
      "book_counterparts",
      "book_members",
      "books",
      "bucket_rules",
      "budgets",
      "csv_presets",
      "invitations",
      "journal_entries",
      "journal_entry_versions",
      "journal_lines",
      "loans",
      "opening_balances",
      "payee_matches",
      "payees",
      "reconciliation_items",
      "reconciliations",
      "simplefin_connections",
      "simplefin_requests",
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
        .values({ bookId: book.id, name: "X", type: "cash", subtype: "checking" }),
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
        subtype: "checking",
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
