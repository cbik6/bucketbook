import { describe, expect, it } from "vitest";
import { listAccounts } from "@/server/accounts/service";
import { createBook } from "@/server/books/service";
import { createBucket, enableBuckets, moveBetweenBuckets } from "@/server/buckets/service";
import { getDb } from "@/server/db/client";
import { postEntry, saveOpeningBalances } from "@/server/ledger/service";
import { copyPreviousMonth, saveBudget } from "@/server/reports/budget-service";
import {
  balanceSheet,
  bucketSummary,
  budgetVsActual,
  netWorthByMonth,
  profitAndLoss,
  spendingByMonth,
  toCsv,
} from "@/server/reports/service";
import { addMoneyAccounts, makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

async function setup() {
  const user = await makeUser();
  const actor = { userId: user.id };
  const { book } = await createBook(getDb(), actor, {
    name: "Home",
    template: "household",
    startDate: "2025-12-01",
  });
  await addMoneyAccounts(actor, book.id, "household");
  const rows = await listAccounts(getDb(), book.id);
  const id = (name: string) => rows.find((a) => a.name === name)!.id;
  const post = (date: string, debit: string, credit: string, amount: string) =>
    postEntry(getDb(), actor, book.id, {
      entryDate: date,
      memo: "",
      lines: [
        { accountId: id(debit), debit: amount, credit: "", memo: "" },
        { accountId: id(credit), debit: "", credit: amount, memo: "" },
      ],
    });
  await saveOpeningBalances(getDb(), actor, book.id, {
    [id("Checking")]: "1,000",
    [id("Credit Card")]: "200",
  });
  await post("2025-12-15", "Checking", "Paychecks", "500");
  await post("2025-12-20", "Groceries", "Credit Card", "80");
  await post("2026-01-05", "Checking", "Paychecks", "3,000");
  await post("2026-01-10", "Groceries", "Checking", "250");
  await post("2026-01-12", "Dining Out", "Credit Card", "60");
  await post("2026-02-03", "Rent or Mortgage", "Checking", "1,200");
  await post("2026-02-09", "Credit Card", "Checking", "340");
  return { actor, bookId: book.id, id };
}

describe("reports tie out", () => {
  it("the Balance Sheet balances, with earnings split into retained and this year", async () => {
    const ctx = await setup();
    for (const asOf of ["2025-12-31", "2026-01-31", "2026-02-28"]) {
      const bs = await balanceSheet(getDb(), ctx.bookId, asOf);
      expect(bs.outOfBalanceCents).toBe(0);
      expect(bs.assetsCents).toBe(bs.liabilitiesCents + bs.equityCents);
    }
    const feb = await balanceSheet(getDb(), ctx.bookId, "2026-02-28");
    expect(feb.retainedEarningsCents).toBe(50_000 - 8_000);
    expect(feb.netIncomeCents).toBe(300_000 - 25_000 - 6_000 - 120_000);
    expect(feb.liabilitiesCents).toBe(0);
  });

  it("P&L net income equals the change in equity over the same period", async () => {
    const ctx = await setup();
    const pl = await profitAndLoss(getDb(), ctx.bookId, { from: "2026-01-01", to: "2026-02-28" });
    const before = await balanceSheet(getDb(), ctx.bookId, "2025-12-31");
    const after = await balanceSheet(getDb(), ctx.bookId, "2026-02-28");
    expect(pl.netIncomeCents).toBe(after.equityCents - before.equityCents);
    expect(pl.incomeCents).toBe(300_000);
    expect(pl.expenseCents).toBe(25_000 + 6_000 + 120_000);
    // Parents roll up their children.
    const food = pl.lines.find((l) => l.name === "Food")!;
    expect(food.totalCents).toBe(25_000 + 6_000);
  });

  it("monthly columns add up to the totals", async () => {
    const ctx = await setup();
    const pl = await profitAndLoss(
      getDb(),
      ctx.bookId,
      { from: "2025-12-01", to: "2026-02-28" },
      { monthly: true },
    );
    expect(pl.months).toEqual(["2025-12", "2026-01", "2026-02"]);
    for (const l of pl.lines) {
      const sum = Object.values(l.columns ?? {}).reduce((n, v) => n + v, 0);
      expect(sum).toBe(l.totalCents);
    }
    expect(Object.values(pl.netColumns).reduce((n, v) => n + v, 0)).toBe(pl.netIncomeCents);
    const spending = await spendingByMonth(getDb(), ctx.bookId, {
      from: "2026-01-01",
      to: "2026-02-28",
    });
    expect(spending.series[0]).toMatchObject({ name: "Home", values: [0, 120_000] });
  });

  it("net worth is assets minus liabilities at each month end", async () => {
    const ctx = await setup();
    const nw = await netWorthByMonth(getDb(), ctx.bookId, { from: "2025-12-01", to: "2026-02-28" });
    expect(nw.map((m) => m.month)).toEqual(["2025-12", "2026-01", "2026-02"]);
    for (const m of nw) {
      const bs = await balanceSheet(
        getDb(),
        ctx.bookId,
        `${m.month}-${m.month === "2026-02" ? "28" : "31"}`,
      );
      expect(m.netWorthCents).toBe(bs.assetsCents - bs.liabilitiesCents);
    }
  });
});

describe("budgets", () => {
  it("compares budget with actual and copies last month", async () => {
    const ctx = await setup();
    await saveBudget(getDb(), ctx.actor, ctx.bookId, "2026-01", {
      [ctx.id("Groceries")]: "300",
      [ctx.id("Dining Out")]: "50",
      [ctx.id("Paychecks")]: "3,000",
      [ctx.id("Checking")]: "999",
    });
    await copyPreviousMonth(getDb(), ctx.actor, ctx.bookId, "2026-02");
    const jan = await budgetVsActual(getDb(), ctx.bookId, { from: "2026-01-01", to: "2026-01-31" });
    const groceries = jan.lines.find((l) => l.name === "Groceries")!;
    expect(groceries).toMatchObject({ budgetCents: 30_000, totalCents: 25_000 });
    expect(jan.lines.find((l) => l.name === "Food")!.budgetCents).toBe(35_000);
    expect(jan.expense).toEqual({ actual: 31_000, budget: 35_000 });
    expect(jan.income).toEqual({ actual: 300_000, budget: 300_000 });
    const both = await budgetVsActual(getDb(), ctx.bookId, {
      from: "2026-01-01",
      to: "2026-02-28",
    });
    expect(both.expense.budget).toBe(70_000);
    await expect(copyPreviousMonth(getDb(), ctx.actor, ctx.bookId, "2025-11")).rejects.toThrow(
      /no budget/,
    );
  });
});

describe("bucket summary", () => {
  it("shows start, in, out and end per bucket", async () => {
    const ctx = await setup();
    const { unassignedId } = await enableBuckets(getDb(), ctx.actor, ctx.bookId, ctx.id("Savings"));
    const car = await createBucket(getDb(), ctx.actor, ctx.bookId, ctx.id("Savings"), {
      name: "Car",
      goal: "1,000",
    });
    await postEntry(getDb(), ctx.actor, ctx.bookId, {
      entryDate: "2026-01-02",
      memo: "",
      lines: [
        { accountId: unassignedId, debit: "500", credit: "", memo: "" },
        { accountId: ctx.id("Checking"), debit: "", credit: "500", memo: "" },
      ],
    });
    await moveBetweenBuckets(getDb(), ctx.actor, ctx.bookId, {
      fromId: unassignedId,
      toId: car.id,
      amount: "200",
      date: "2026-02-01",
    });
    const [savings] = await bucketSummary(
      getDb(),
      ctx.bookId,
      { from: "2026-02-01", to: "2026-02-28" },
      "2026-02-28",
    );
    const [un, c] = savings!.buckets;
    expect(un).toMatchObject({ startCents: 50_000, outflowCents: 20_000, endCents: 30_000 });
    expect(c).toMatchObject({ startCents: 0, inflowCents: 20_000, endCents: 20_000 });
    expect(c!.goal!.fraction).toBeCloseTo(0.2);
  });
});

describe("CSV export", () => {
  it("quotes fields and neutralizes formulas", () => {
    expect(
      toCsv([
        ["Name", "Amount"],
        ['Joe "JJ", Inc', "-12.50"],
        ["=SUM(A1)", "1"],
      ]),
    ).toBe('Name,Amount\r\n"Joe ""JJ"", Inc",-12.50\r\n\'=SUM(A1),1\r\n');
  });
});
