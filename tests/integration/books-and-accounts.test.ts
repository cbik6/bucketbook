import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  listAccounts,
  unarchiveAccount,
  updateAccount,
} from "@/server/accounts/service";
import { CHART_TEMPLATES, templateSummaries } from "@/server/accounts/templates";
import {
  createBook,
  listBooksForUser,
  renameBook,
  requireBookAccess,
  setBookArchived,
} from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { auditLog, bookMembers } from "@/server/db/schema";
import { NotFoundError, UserFacingError } from "@/server/errors";
import { makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

const expense = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  type: "expense",
  subtype: "expense",
  ...extra,
});

describe("creating a book from a template", () => {
  it.each(["household", "small_business", "blank"] as const)(
    "%s: copies every template account with nesting, roles and an owner",
    async (template) => {
      const user = await makeUser();
      const { book, accountCount } = await createBook(
        getDb(),
        { userId: user.id },
        { name: "  My Book ", template, startDate: "2026-01-01" },
      );
      expect(book.name).toBe("My Book");
      expect(book.currencyCode).toBe("USD");

      const expected = templateSummaries().find((t) => t.id === template)!.accountCount;
      const rows = await listAccounts(getDb(), book.id);
      expect(rows).toHaveLength(expected);
      expect(accountCount).toBe(expected);

      const roles = rows
        .filter((r) => r.systemRole)
        .map((r) => r.systemRole)
        .sort();
      expect(roles).toEqual(["opening_balance_equity", "retained_earnings"]);
      expect(rows.filter((r) => r.isSystem)).toHaveLength(2);

      // Children keep their parent's type.
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const r of rows) {
        if (r.parentAccountId) expect(byId.get(r.parentAccountId)!.type).toBe(r.type);
      }

      const [member] = await getDb()
        .select()
        .from(bookMembers)
        .where(eq(bookMembers.bookId, book.id));
      expect(member).toMatchObject({ userId: user.id, role: "owner" });

      const audits = await getDb().select().from(auditLog).where(eq(auditLog.bookId, book.id));
      expect(audits.filter((a) => a.entityType === "book")).toHaveLength(1);
      expect(audits.filter((a) => a.entityType === "account")).toHaveLength(expected);
    },
  );

  it("nests Household expenses (Food > Groceries)", async () => {
    const user = await makeUser();
    const { book } = await createBook(
      getDb(),
      { userId: user.id },
      { name: "Home", template: "household", startDate: "2026-01-01" },
    );
    const rows = await listAccounts(getDb(), book.id);
    const food = rows.find((r) => r.name === "Food")!;
    expect(rows.find((r) => r.name === "Groceries")!.parentAccountId).toBe(food.id);
    expect(CHART_TEMPLATES.household.accounts.expense.length).toBeGreaterThan(5);
  });

  it("validates name, template and date with friendly messages", async () => {
    const user = await makeUser();
    const actor = { userId: user.id };
    await expect(
      createBook(getDb(), actor, { name: "", template: "blank", startDate: "2026-01-01" }),
    ).rejects.toThrow(/name/);
    await expect(
      createBook(getDb(), actor, { name: "X", template: "nope", startDate: "2026-01-01" }),
    ).rejects.toThrow(/starting chart/);
    await expect(
      createBook(getDb(), actor, { name: "X", template: "blank", startDate: "2026-02-30" }),
    ).rejects.toThrow(/real date/);
  });
});

describe("book access, rename and archive", () => {
  it("hides books from people who are not members", async () => {
    const owner = await makeUser("Owner");
    const stranger = await makeUser("Stranger");
    const { book } = await createBook(
      getDb(),
      { userId: owner.id },
      { name: "Private", template: "blank", startDate: "2026-01-01" },
    );
    await expect(requireBookAccess(getDb(), stranger.id, book.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(requireBookAccess(getDb(), owner.id, "not-a-uuid")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(await listBooksForUser(getDb(), stranger.id)).toEqual([]);
  });

  it("renames and archives, recording each change in the audit log", async () => {
    const user = await makeUser();
    const actor = { userId: user.id };
    const { book } = await createBook(getDb(), actor, {
      name: "Old",
      template: "blank",
      startDate: "2026-01-01",
    });
    await renameBook(getDb(), actor, book.id, "New");
    await setBookArchived(getDb(), actor, book.id, true);
    expect(await listBooksForUser(getDb(), user.id)).toEqual([]);
    const all = await listBooksForUser(getDb(), user.id, { includeArchived: true });
    expect(all[0]!.name).toBe("New");
    await expect(setBookArchived(getDb(), actor, book.id, true)).rejects.toThrow(/already/);
    await setBookArchived(getDb(), actor, book.id, false);

    const actions = (
      await getDb()
        .select()
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "book"), eq(auditLog.entityId, book.id)))
    ).map((a) => a.action);
    expect(actions).toEqual(["create", "update", "archive", "unarchive"]);
  });
});

describe("chart of accounts service", () => {
  async function setup() {
    const user = await makeUser();
    const actor = { userId: user.id };
    const { book } = await createBook(getDb(), actor, {
      name: "Test",
      template: "blank",
      startDate: "2026-01-01",
    });
    return { actor, bookId: book.id };
  }

  it("creates nested accounts without a depth limit", async () => {
    const { actor, bookId } = await setup();
    let parentAccountId: string | undefined;
    for (let depth = 0; depth < 8; depth++) {
      const row = await createAccount(
        getDb(),
        actor,
        bookId,
        expense(`Level ${depth}`, { parentAccountId: parentAccountId ?? "" }),
      );
      parentAccountId = row.id;
    }
    const rows = await listAccounts(getDb(), bookId);
    expect(rows.filter((r) => r.type === "expense")).toHaveLength(8);
  });

  it("turns database conflicts into friendly messages", async () => {
    const { actor, bookId } = await setup();
    await createAccount(getDb(), actor, bookId, expense("Rent", { code: "6100" }));
    await expect(
      createAccount(getDb(), actor, bookId, expense("Lease", { code: "6100" })),
    ).rejects.toThrow("Another account already uses number 6100.");
    await expect(createAccount(getDb(), actor, bookId, expense("rent"))).rejects.toThrow(
      /already an account named "rent"/,
    );
  });

  it("refuses to move an account under its own descendant", async () => {
    const { actor, bookId } = await setup();
    const home = await createAccount(getDb(), actor, bookId, expense("Home"));
    const util = await createAccount(
      getDb(),
      actor,
      bookId,
      expense("Utilities", { parentAccountId: home.id }),
    );
    await expect(
      updateAccount(getDb(), actor, bookId, home.id, expense("Home", { parentAccountId: util.id })),
    ).rejects.toBeInstanceOf(UserFacingError);
  });

  it("refuses a parent of another type and a parent from another book", async () => {
    const { actor, bookId } = await setup();
    const other = await setup();
    const asset = await createAccount(getDb(), actor, bookId, {
      name: "Checking",
      type: "asset",
      subtype: "bank",
    });
    await expect(
      createAccount(getDb(), actor, bookId, expense("Fees", { parentAccountId: asset.id })),
    ).rejects.toThrow(/same type/);
    const foreign = await createAccount(getDb(), other.actor, other.bookId, expense("Foreign"));
    await expect(
      createAccount(getDb(), actor, bookId, expense("Sneaky", { parentAccountId: foreign.id })),
    ).rejects.toThrow(/doesn't exist in this book/);
  });

  it("archives leaves first, restores, and audits each step", async () => {
    const { actor, bookId } = await setup();
    const home = await createAccount(getDb(), actor, bookId, expense("Home"));
    const util = await createAccount(
      getDb(),
      actor,
      bookId,
      expense("Utilities", { parentAccountId: home.id }),
    );

    await expect(archiveAccount(getDb(), actor, bookId, home.id)).rejects.toThrow(
      /sub-accounts first/,
    );
    await archiveAccount(getDb(), actor, bookId, util.id);
    const archivedHome = await archiveAccount(getDb(), actor, bookId, home.id);
    expect(archivedHome.archivedAt).toBeInstanceOf(Date);

    await expect(unarchiveAccount(getDb(), actor, bookId, util.id)).rejects.toThrow(/parent/);
    await unarchiveAccount(getDb(), actor, bookId, home.id);
    await unarchiveAccount(getDb(), actor, bookId, util.id);

    const actions = (
      await getDb().select().from(auditLog).where(eq(auditLog.entityId, util.id))
    ).map((a) => a.action);
    expect(actions).toEqual(["create", "archive", "unarchive"]);
  });

  it("protects system accounts but lets you rename them", async () => {
    const { actor, bookId } = await setup();
    const obe = (await listAccounts(getDb(), bookId)).find(
      (r) => r.systemRole === "opening_balance_equity",
    )!;
    await expect(archiveAccount(getDb(), actor, bookId, obe.id)).rejects.toThrow(/used by the app/);
    await expect(deleteAccount(getDb(), actor, bookId, obe.id)).rejects.toThrow(/can't be deleted/);
    await expect(
      updateAccount(getDb(), actor, bookId, obe.id, {
        name: "Opening Balance Equity",
        type: "asset",
        subtype: "bank",
      }),
    ).rejects.toThrow(/System accounts/);
    const renamed = await updateAccount(getDb(), actor, bookId, obe.id, {
      name: "Opening Balances",
      type: "equity",
      subtype: "opening_balance",
    });
    expect(renamed.name).toBe("Opening Balances");
    expect(renamed.systemRole).toBe("opening_balance_equity");
  });

  it("deletes an unused leaf account and keeps the audit trail", async () => {
    const { actor, bookId } = await setup();
    const temp = await createAccount(getDb(), actor, bookId, expense("Typo Acount"));
    await deleteAccount(getDb(), actor, bookId, temp.id);
    expect((await listAccounts(getDb(), bookId)).some((r) => r.id === temp.id)).toBe(false);
    const actions = (
      await getDb().select().from(auditLog).where(eq(auditLog.entityId, temp.id))
    ).map((a) => a.action);
    expect(actions).toEqual(["create", "delete"]);
  });
});
