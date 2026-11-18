import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listAccounts } from "@/server/accounts/service";
import { bankableAccounts } from "@/server/bank/accounts";
import { importCsv } from "@/server/bank/csv-service";
import { approveItem, approveTransfer, listQueue } from "@/server/bank/review-service";
import { createRule } from "@/server/bank/rules-service";
import { createBook } from "@/server/books/service";
import {
  bucketOverview,
  createBucket,
  createBucketRule,
  enableBuckets,
  moveBetweenBuckets,
  runMonthlyRules,
  updateBucket,
} from "@/server/buckets/service";
import { getDb } from "@/server/db/client";
import { accounts, bankTransactions } from "@/server/db/schema";
import { accountNetCents } from "@/server/ledger/queries";
import { postEntry, saveOpeningBalances } from "@/server/ledger/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

async function setup() {
  const user = await makeUser();
  const actor = { userId: user.id };
  const { book } = await createBook(getDb(), actor, {
    name: "Home",
    template: "household",
    startDate: "2026-01-01",
  });
  await addMoneyAccounts(actor, book.id, "household");
  const id = async (name: string) => {
    const rows = await listAccounts(getDb(), book.id);
    const r = rows.find((a) => a.name === name);
    if (!r) throw new Error(`no account ${name}`);
    return r.id;
  };
  return { user, actor, bookId: book.id, id };
}

/** The bucket invariant: a real account equals the sum of its buckets plus its own old lines. */
async function totalOf(parentId: string) {
  const r = await getDb().execute<{ n: string }>(sql`
    select coalesce(sum(l.net_cents), 0)::text as n from ledger_lines l
    join accounts a on a.id = l.account_id
    where a.id = ${parentId} or (a.parent_account_id = ${parentId} and a.is_bucket)
  `);
  return Number(r.rows[0]!.n);
}

async function csv(
  ctx: Awaited<ReturnType<typeof setup>>,
  accountName: string,
  rows: Array<[string, number, string]>,
) {
  await importCsv(getDb(), ctx.actor, ctx.bookId, {
    accountId: await ctx.id(accountName),
    mapping: {
      dateColumn: 0,
      dateFormat: "YYYY-MM-DD",
      descriptionColumn: 1,
      amountMode: "signed",
      amountColumn: 2,
    },
    rows: rows.map(([postedDate, amountCents, description], i) => ({
      line: i + 2,
      postedDate,
      amountCents,
      description,
      payee: null,
      memo: null,
    })),
  });
  return (await listQueue(getDb(), ctx.user.id, ctx.bookId, "review")).filter((q) =>
    rows.some((r) => r[2] === q.description),
  );
}

describe("buckets", () => {
  it("turning on buckets moves the balance to Unassigned and stops direct posting", async () => {
    const ctx = await setup();
    const savings = await ctx.id("Savings");
    await saveOpeningBalances(getDb(), ctx.actor, ctx.bookId, { [savings]: "5,000" });
    const { unassignedId, movedCents } = await enableBuckets(
      getDb(),
      ctx.actor,
      ctx.bookId,
      savings,
      {
        names: ["Car", "Vacation"],
      },
    );
    expect(movedCents).toBe(500_000);
    expect(await accountNetCents(getDb(), unassignedId)).toBe(500_000);
    expect(await totalOf(savings)).toBe(500_000);

    // The real account no longer takes postings; its buckets do.
    await expect(
      postEntry(getDb(), ctx.actor, ctx.bookId, {
        entryDate: "2026-03-01",
        memo: "",
        lines: [
          { accountId: savings, debit: "10", credit: "", memo: "" },
          { accountId: await ctx.id("Other Income"), debit: "", credit: "10", memo: "" },
        ],
      }),
    ).rejects.toThrow(/holds buckets/);
    await expect(
      getDb().execute(sql`
        insert into journal_lines (book_id, entry_id, version, line_number, account_id, debit_cents)
        select book_id, entry_id, version, 99, ${savings}, 1 from journal_lines limit 1
      `),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        message: expect.stringMatching(/does not accept postings/),
      }),
    });

    const overview = await bucketOverview(getDb(), ctx.bookId);
    expect(overview.accounts[0]!.buckets.map((b) => b.name)).toEqual([
      "Unassigned",
      "Car",
      "Vacation",
    ]);
    expect(overview.accounts[0]!.totalCents).toBe(500_000);
    expect(overview.eligible.map((e) => e.name)).not.toContain("Savings");
    // It still takes bank data (CSV and SimpleFIN), landing in its buckets.
    expect((await bankableAccounts(getDb(), ctx.bookId)).map((a) => a.name)).toContain("Savings");
  });

  it("moves money between buckets but never more than a bucket holds", async () => {
    const ctx = await setup();
    const savings = await ctx.id("Savings");
    await saveOpeningBalances(getDb(), ctx.actor, ctx.bookId, { [savings]: "1,000" });
    const { unassignedId } = await enableBuckets(getDb(), ctx.actor, ctx.bookId, savings);
    const car = await createBucket(getDb(), ctx.actor, ctx.bookId, savings, {
      name: "Car",
      goal: "4,000",
      goalDate: "2027-06-01",
    });
    await moveBetweenBuckets(getDb(), ctx.actor, ctx.bookId, {
      fromId: unassignedId,
      toId: car.id,
      amount: "600",
      date: "2026-03-01",
    });
    expect(await accountNetCents(getDb(), car.id)).toBe(60_000);
    await expect(
      moveBetweenBuckets(getDb(), ctx.actor, ctx.bookId, {
        fromId: unassignedId,
        toId: car.id,
        amount: "500",
        date: "2026-03-01",
      }),
    ).rejects.toThrow(/holds \$400\.00/);
    expect(await totalOf(savings)).toBe(100_000);
    await expect(
      updateBucket(getDb(), ctx.actor, ctx.bookId, car.id, { name: "Car", goalDate: "2027-01-01" }),
    ).rejects.toThrow(/goal amount/);
  });

  it("deposits from review land in Unassigned and run allocation rules; withdrawals draw from the chosen bucket", async () => {
    const ctx = await setup();
    const checking = await ctx.id("Checking");
    const { unassignedId } = await enableBuckets(getDb(), ctx.actor, ctx.bookId, checking);
    const car = await createBucket(getDb(), ctx.actor, ctx.bookId, checking, { name: "Car" });
    const fun = await createBucket(getDb(), ctx.actor, ctx.bookId, checking, { name: "Fun" });
    await createBucketRule(getDb(), ctx.actor, ctx.bookId, checking, {
      bucketAccountId: car.id,
      kind: "fixed",
      amount: "200",
    });
    await createBucketRule(getDb(), ctx.actor, ctx.bookId, checking, {
      bucketAccountId: fun.id,
      kind: "percent",
      percent: "10",
      minDeposit: "500",
    });
    const [pay] = await csv(ctx, "Checking", [["2026-03-01", 300_000, "PAYROLL"]]);
    await approveItem(getDb(), ctx.actor, ctx.bookId, pay!.id, {
      accountId: await ctx.id("Paychecks"),
    });
    expect(await accountNetCents(getDb(), car.id)).toBe(20_000);
    expect(await accountNetCents(getDb(), fun.id)).toBe(30_000);
    expect(await accountNetCents(getDb(), unassignedId)).toBe(250_000);

    // A rule pre-fills the bucket for a withdrawal.
    await createRule(getDb(), ctx.actor, ctx.bookId, {
      name: "Car repair",
      conditions: { text: { value: "auto shop" } },
      actions: { offsetAccountId: await ctx.id("Car Maintenance"), bucketAccountId: car.id },
    });
    const [repair] = await csv(ctx, "Checking", [["2026-03-05", -15_000, "AUTO SHOP"]]);
    expect(repair!.suggestedAccountId).toBe(await ctx.id("Car Maintenance"));
    await approveItem(getDb(), ctx.actor, ctx.bookId, repair!.id, {});
    expect(await accountNetCents(getDb(), car.id)).toBe(5_000);
    expect(await totalOf(checking)).toBe(285_000);
  });

  it("matches a transfer into a bucketed account and allocates it", async () => {
    const ctx = await setup();
    const savings = await ctx.id("Savings");
    const { unassignedId } = await enableBuckets(getDb(), ctx.actor, ctx.bookId, savings);
    const trip = await createBucket(getDb(), ctx.actor, ctx.bookId, savings, { name: "Trip" });
    await createBucketRule(getDb(), ctx.actor, ctx.bookId, savings, {
      bucketAccountId: trip.id,
      kind: "percent",
      percent: "50",
    });
    const [out] = await csv(ctx, "Checking", [["2026-03-01", -40_000, "TO SAVINGS"]]);
    const [into] = await csv(ctx, "Savings", [["2026-03-02", 40_000, "FROM CHECKING"]]);
    await approveTransfer(getDb(), ctx.actor, ctx.bookId, out!.id, { partnerId: into!.id });
    expect(await accountNetCents(getDb(), trip.id)).toBe(20_000);
    expect(await accountNetCents(getDb(), unassignedId)).toBe(20_000);
    const [row] = await getDb()
      .select()
      .from(bankTransactions)
      .where(eq(bankTransactions.id, into!.id));
    expect(row!.status).toBe("posted");
  });

  it("runs monthly rules once a month from what Unassigned holds", async () => {
    const ctx = await setup();
    const savings = await ctx.id("Savings");
    await saveOpeningBalances(getDb(), ctx.actor, ctx.bookId, { [savings]: "300" });
    const { unassignedId } = await enableBuckets(getDb(), ctx.actor, ctx.bookId, savings);
    const a = await createBucket(getDb(), ctx.actor, ctx.bookId, savings, { name: "Gifts" });
    const b = await createBucket(getDb(), ctx.actor, ctx.bookId, savings, { name: "Taxes" });
    await createBucketRule(getDb(), ctx.actor, ctx.bookId, savings, {
      bucketAccountId: a.id,
      kind: "monthly",
      amount: "200",
    });
    await createBucketRule(getDb(), ctx.actor, ctx.bookId, savings, {
      bucketAccountId: b.id,
      kind: "monthly",
      amount: "200",
    });
    await runMonthlyRules(getDb(), ctx.actor, { bookId: ctx.bookId, today: "2026-11-02" });
    expect(await accountNetCents(getDb(), a.id)).toBe(20_000);
    expect(await accountNetCents(getDb(), b.id)).toBe(10_000);
    expect(await accountNetCents(getDb(), unassignedId)).toBe(0);
    // Running again the same month does nothing; next month tries again.
    await runMonthlyRules(getDb(), ctx.actor, { bookId: ctx.bookId, today: "2026-11-20" });
    expect(await accountNetCents(getDb(), a.id)).toBe(20_000);
    expect(await totalOf(savings)).toBe(30_000);
  });

  it("refuses buckets on accounts that can't hold them", async () => {
    const ctx = await setup();
    await expect(
      enableBuckets(getDb(), ctx.actor, ctx.bookId, await ctx.id("Credit Card")),
    ).rejects.toThrow(/asset accounts/);
    const savings = await ctx.id("Savings");
    await enableBuckets(getDb(), ctx.actor, ctx.bookId, savings);
    await expect(enableBuckets(getDb(), ctx.actor, ctx.bookId, savings)).rejects.toThrow(
      /already has buckets/,
    );
    const [un] = await getDb().select().from(accounts).where(eq(accounts.isUnassigned, true));
    expect(un).toMatchObject({ isSystem: true, parentAccountId: savings });
  });
});
