import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAccounts } from "@/server/accounts/service";
import { importCsv } from "@/server/bank/csv-service";
import { applyDecisions, approveItem, listQueue } from "@/server/bank/review-service";
import { createBook } from "@/server/books/service";
import { getDb, getPool } from "@/server/db/client";
import { bankTransactions, journalEntries, payees } from "@/server/db/schema";
import { editEntry, listEntries, postEntry, reverseEntry } from "@/server/ledger/service";
import {
  createPayee,
  listPayees,
  mergePayees,
  payeeChoices,
  updatePayee,
} from "@/server/payees/service";
import { spendingByPayee } from "@/server/reports/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

async function setupBook() {
  const u = await makeUser();
  const actor = { userId: u.id };
  const { book } = await createBook(getDb(), actor, {
    name: "Home",
    template: "household",
    startDate: "2026-01-01",
  });
  await addMoneyAccounts(actor, book.id, "household");
  const rows = await listAccounts(getDb(), book.id);
  const id = (name: string) => {
    const r = rows.find((a) => a.name === name);
    if (!r) throw new Error(`no account ${name}`);
    return r.id;
  };
  return { user: u, actor, bookId: book.id, id };
}
type Ctx = Awaited<ReturnType<typeof setupBook>>;

/** A $amount purchase from Checking, written by hand. */
const purchase = (ctx: Ctx, payee: string | null, amount: string, category = "Groceries") =>
  postEntry(getDb(), ctx.actor, ctx.bookId, {
    entryDate: "2026-03-04",
    payee,
    memo: "",
    lines: [
      { accountId: ctx.id(category), debit: amount, credit: "", memo: "" },
      { accountId: ctx.id("Checking"), debit: "", credit: amount, memo: "" },
    ],
  });

async function importRows(ctx: Ctx, rows: Array<[string, number, string, string?]>) {
  await importCsv(getDb(), ctx.actor, ctx.bookId, {
    accountId: ctx.id("Checking"),
    mapping: {
      dateColumn: 0,
      dateFormat: "YYYY-MM-DD",
      descriptionColumn: 1,
      amountMode: "signed",
      amountColumn: 2,
    },
    rows: rows.map(([postedDate, amountCents, description, payee], i) => ({
      line: i + 2,
      postedDate,
      amountCents,
      description,
      payee: payee ?? null,
      memo: null,
    })),
  });
  return listQueue(getDb(), ctx.user.id, ctx.bookId, "review");
}

const entryRow = async (id: string) =>
  (await getDb().select().from(journalEntries).where(eq(journalEntries.id, id)))[0]!;

describe("payees on journal entries", () => {
  it("adds a typed payee to the list once, whatever its spacing or case", async () => {
    const ctx = await setupBook();
    const a = await purchase(ctx, "Broulim's", "20.00");
    const b = await purchase(ctx, "  broulim's ", "15.00");
    const list = await payeeChoices(getDb(), ctx.bookId);
    expect(list.map((p) => p.name)).toEqual(["Broulim's"]);
    expect(a.payeeId).toBe(list[0]!.id);
    // The second entry links to the same payee and takes its spelling.
    expect(b).toMatchObject({ payeeId: list[0]!.id, payee: "Broulim's" });
  });

  it("an edit that changes the payee links the new one; one that keeps it keeps the link", async () => {
    const ctx = await setupBook();
    const entry = await purchase(ctx, "Costco", "40.00");
    const lines = [
      { accountId: ctx.id("Groceries"), debit: "45.00", credit: "", memo: "" },
      { accountId: ctx.id("Checking"), debit: "", credit: "45.00", memo: "" },
    ];
    await editEntry(getDb(), ctx.actor, ctx.bookId, entry.id, {
      entryDate: "2026-03-04",
      payee: "Costco",
      memo: "",
      lines,
    });
    expect((await entryRow(entry.id)).payeeId).toBe(entry.payeeId);
    await editEntry(getDb(), ctx.actor, ctx.bookId, entry.id, {
      entryDate: "2026-03-04",
      payee: "Costco Gas",
      memo: "",
      lines,
    });
    const after = await entryRow(entry.id);
    const gas = (await payeeChoices(getDb(), ctx.bookId)).find((p) => p.name === "Costco Gas");
    expect(after).toMatchObject({ payee: "Costco Gas", payeeId: gas!.id });
  });
});

describe("payees in review", () => {
  it("keeps raw bank text off the list, learns a name you choose, and suggests it next time", async () => {
    const ctx = await setupBook();
    let queue = await importRows(ctx, [
      ["2026-03-02", -921, "TACO BELL 729852 22 WEST MAIN ST REXBURG"],
      ["2026-03-03", -1100, "VALLEY WIDE REXBURG 1175"],
    ]);
    const taco = queue.find((q) => q.description.startsWith("TACO"))!;
    const valley = queue.find((q) => q.description.startsWith("VALLEY"))!;
    expect(taco.payeeMatch).toBeNull();

    // Left as the bank's text: an entry, but no payee on the list.
    await approveItem(getDb(), ctx.actor, ctx.bookId, valley.id, {
      accountId: ctx.id("Groceries"),
    });
    expect(await payeeChoices(getDb(), ctx.bookId)).toEqual([]);

    // A name you choose joins the list, with its category as the usual one.
    const { entry } = await approveItem(getDb(), ctx.actor, ctx.bookId, taco.id, {
      accountId: ctx.id("Dining Out"),
      payee: "Taco Bell",
    });
    const [tacoBell] = await payeeChoices(getDb(), ctx.bookId);
    expect(tacoBell).toMatchObject({ name: "Taco Bell", defaultAccountId: ctx.id("Dining Out") });
    expect(entry.payeeId).toBe(tacoBell!.id);

    // The next visit, at a different store number, comes in as Taco Bell.
    queue = await importRows(ctx, [["2026-03-09", -1450, "TACO BELL 998877 4TH ST IDAHO FALLS"]]);
    const next = queue.find((q) => q.description.includes("998877"))!;
    expect(next.payeeMatch).toMatchObject({
      name: "Taco Bell",
      defaultAccountId: ctx.id("Dining Out"),
    });
    // Adding it without a payee (as "Add selected" does) uses the matched name.
    await applyDecisions(getDb(), ctx.actor, ctx.bookId, [
      { id: next.id, kind: "account", accountId: ctx.id("Dining Out") },
    ]);
    const [posted] = await getDb()
      .select({ entryId: bankTransactions.entryId })
      .from(bankTransactions)
      .where(eq(bankTransactions.id, next.id));
    expect(await entryRow(posted!.entryId!)).toMatchObject({
      payee: "Taco Bell",
      payeeId: tacoBell!.id,
    });
  });
});

describe("managing payees", () => {
  it("renames everywhere, merges entries and bank text, and refuses a duplicate name", async () => {
    const ctx = await setupBook();
    const a = await purchase(ctx, "Walmart", "30.00");
    const b = await purchase(ctx, "Wal-Mart", "12.00");
    const walmart = a.payeeId!;
    const dashed = b.payeeId!;

    await updatePayee(getDb(), ctx.actor, ctx.bookId, walmart, { name: "Walmart Supercenter" });
    expect((await entryRow(a.id)).payee).toBe("Walmart Supercenter");

    await expect(
      updatePayee(getDb(), ctx.actor, ctx.bookId, dashed, { name: "walmart supercenter" }),
    ).rejects.toThrow(/merge this payee into it/);

    const r = await mergePayees(getDb(), ctx.actor, ctx.bookId, dashed, walmart);
    expect(r.entries).toBe(1);
    expect(await entryRow(b.id)).toMatchObject({
      payee: "Walmart Supercenter",
      payeeId: walmart,
    });
    const list = await listPayees(getDb(), ctx.bookId);
    expect(list.map((p) => [p.name, p.entryCount, p.spentCents])).toEqual([
      ["Walmart Supercenter", 2, 4200],
    ]);
    const filtered = await listEntries(getDb(), ctx.bookId, { payeeId: walmart });
    expect(filtered.total).toBe(2);
  });

  it("archives a payee: it leaves the pickers, its entries keep it, and using it brings it back", async () => {
    const ctx = await setupBook();
    const p = await createPayee(getDb(), ctx.actor, ctx.bookId, {
      name: "Rocky Mountain Power",
      defaultAccountId: ctx.id("Utilities"),
    });
    await expect(
      createPayee(getDb(), ctx.actor, ctx.bookId, { name: "rocky mountain power" }),
    ).rejects.toThrow(/already a payee/);
    await updatePayee(getDb(), ctx.actor, ctx.bookId, p.id, { archived: true });
    expect(await payeeChoices(getDb(), ctx.bookId)).toEqual([]);
    const entry = await purchase(ctx, "Rocky Mountain Power", "80.00", "Utilities");
    expect(entry.payeeId).toBe(p.id);
    const [row] = await getDb().select().from(payees).where(eq(payees.id, p.id));
    expect(row!.archivedAt).toBeNull();
  });
});

describe("spending by payee", () => {
  it("totals spending per payee for a range, leaving out reversed entries", async () => {
    const ctx = await setupBook();
    await purchase(ctx, "Costco", "100.00");
    await purchase(ctx, "Costco", "50.00");
    const oops = await purchase(ctx, "Costco", "999.00");
    await reverseEntry(getDb(), ctx.actor, ctx.bookId, oops.id, { entryDate: "2026-03-05" });
    await purchase(ctx, null, "7.00");
    const rows = await spendingByPayee(getDb(), ctx.bookId, {
      from: "2026-03-01",
      to: "2026-03-31",
    });
    expect(rows.map((r) => [r.name, r.entryCount, r.spentCents, Boolean(r.payeeId)])).toEqual([
      ["Costco", 2, 15000, true],
      ["No payee", 1, 700, false],
    ]);
  });
});

describe("the 0018 migration", () => {
  it("makes payees from names you typed and the bank's payee field, not raw descriptions", async () => {
    const ctx = await setupBook();
    const typed = await purchase(ctx, "Grocery store", "10.00");
    const oops = await purchase(ctx, "Wrong Store", "5.00");
    await reverseEntry(getDb(), ctx.actor, ctx.bookId, oops.id, { entryDate: "2026-03-05" });
    const queue = await importRows(ctx, [
      ["2026-03-02", -500, "BYUI FOOD SVCS 525 S CTR ST"],
      ["2026-03-03", -2500, "COSTCO WHSE#1379 IDAHO FALLS ID", "Costco"],
    ]);
    const raw = await approveItem(getDb(), ctx.actor, ctx.bookId, queue.find((q) => !q.payee)!.id, {
      accountId: ctx.id("Dining Out"),
    });
    const costco = await approveItem(
      getDb(),
      ctx.actor,
      ctx.bookId,
      queue.find((q) => q.payee === "Costco")!.id,
      { accountId: ctx.id("Groceries") },
    );
    // Back to how 1.0.2 left things: no payees, no links.
    await getPool().query("update journal_entries set payee_id = null");
    await getPool().query("delete from payees");
    const sqlText = readFileSync("drizzle/0018_payees.sql", "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.includes('INSERT INTO "payees"') || statement.includes('SET "payee_id"')) {
        await getPool().query(statement);
      }
    }
    const list = await payeeChoices(getDb(), ctx.bookId);
    expect(list.map((p) => p.name)).toEqual(["Costco", "Grocery store"]);
    expect((await entryRow(typed.id)).payeeId).toBe(list[1]!.id);
    expect((await entryRow(costco.entry.id)).payeeId).toBe(list[0]!.id);
    expect((await entryRow(raw.entry.id)).payeeId).toBeNull();
  });
});
