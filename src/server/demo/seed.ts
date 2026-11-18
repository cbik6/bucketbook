import { and, asc, eq } from "drizzle-orm";
import { formatCents } from "@/lib/money";
import { splitPayment } from "@/lib/loans";
import { createAccount, listAccounts } from "../accounts/service";
import { importCsv } from "../bank/csv-service";
import { approveItem, approveTransfer, excludeItem, listQueue } from "../bank/review-service";
import { createRule } from "../bank/rules-service";
import { createBook } from "../books/service";
import {
  createBucketRule,
  enableBuckets,
  moveBetweenBuckets,
  updateBucket,
} from "../buckets/service";
import type { Database } from "../db/client";
import { accounts } from "../db/schema";
import { saveOpeningBalances } from "../ledger/service";
import { loanHints, saveLoan } from "../loans/service";
import { saveBudget } from "../reports/budget-service";

type Actor = { userId: string };

/** A small seeded random generator so the demo looks the same every time. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const day = (y: number, m: number, d: number) => {
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
};

type Row = [date: string, cents: number, description: string];

/**
 * Creates "Demo Household": a few months of realistic bank activity with
 * buckets, a car loan, a credit card, rules, budgets, and the last ten days
 * left in For review, so every screen has something to show.
 */
export async function createDemoBook(db: Database, actor: Actor, today: string) {
  const [ty, tm] = today.split("-").map(Number) as [number, number];
  const startMonth = tm - 1 - 3;
  const start = day(ty, startMonth, 1);
  const { book } = await createBook(db, actor, {
    name: "Demo Household",
    template: "household",
    startDate: start,
  });
  const bookId = book.id;
  const loan = await createAccount(db, actor, bookId, {
    name: "Car Loan",
    type: "liability",
    subtype: "loan",
  });
  await createAccount(db, actor, bookId, {
    name: "Interest Paid",
    type: "expense",
    subtype: "expense",
  });
  const rows = await listAccounts(db, bookId);
  const id = (name: string) => {
    const r = rows.find((a) => a.name === name);
    if (!r) throw new Error(`Demo: no account ${name}`);
    return r.id;
  };

  await saveOpeningBalances(db, actor, bookId, {
    [id("Checking")]: "3,200",
    [id("Savings")]: "12,000",
    [id("Credit Card")]: "640",
    [loan.id]: "18,000",
  });

  // Savings gets buckets with goals and rules.
  const { unassignedId } = await enableBuckets(db, actor, bookId, id("Savings"), {
    names: ["Emergency", "Car", "Vacation"],
  });
  const buckets = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.parentAccountId, id("Savings")), eq(accounts.isBucket, true)))
    .orderBy(asc(accounts.sortOrder));
  const bucket = (name: string) => buckets.find((b) => b.name === name)!.id;
  const goalYear = ty + 1;
  await updateBucket(db, actor, bookId, bucket("Emergency"), {
    name: "Emergency",
    goal: "15,000",
    goalDate: "",
  });
  await updateBucket(db, actor, bookId, bucket("Car"), {
    name: "Car",
    goal: "4,000",
    goalDate: `${goalYear}-06-01`,
  });
  await updateBucket(db, actor, bookId, bucket("Vacation"), {
    name: "Vacation",
    goal: "3,000",
    goalDate: `${goalYear}-03-01`,
  });
  for (const [name, amount] of [
    ["Emergency", "8,000"],
    ["Car", "2,000"],
    ["Vacation", "1,000"],
  ] as const) {
    await moveBetweenBuckets(db, actor, bookId, {
      fromId: unassignedId,
      toId: bucket(name),
      amount,
      date: start,
      memo: "Starting split",
    });
  }
  await createBucketRule(db, actor, bookId, id("Savings"), {
    bucketAccountId: bucket("Vacation"),
    kind: "percent",
    percent: "10",
  });
  await createBucketRule(db, actor, bookId, id("Savings"), {
    bucketAccountId: bucket("Car"),
    kind: "monthly",
    amount: "200",
  });

  const savedLoan = await saveLoan(db, actor, bookId, null, {
    accountId: loan.id,
    interestAccountId: id("Interest Paid"),
    principal: "18,000",
    rate: "5.9",
    termMonths: "60",
    firstPaymentDate: day(ty, startMonth, 15),
  });

  const rule = (name: string, text: string, account: string, payee?: string) =>
    createRule(db, actor, bookId, {
      name,
      conditions: { text: { value: text } },
      actions: { offsetAccountId: id(account), payee: payee ?? null },
    });
  await rule("Groceries", "fresh market", "Groceries", "Fresh Market");
  await rule("Fuel", "shell", "Fuel", "Shell");
  await rule("Streaming", "netflix", "Subscriptions", "Netflix");
  await rule("Power", "city power", "Utilities", "City Power");
  await rule("Internet", "fiberlink", "Internet and Phone", "FiberLink");
  await rule("Rent", "oak street rent", "Rent or Mortgage", "Oak Street Apartments");
  await rule("Pay", "acme payroll", "Paychecks", "Acme Co");
  await rule("Coffee", "corner cafe", "Dining Out", "Corner Cafe");
  await rule("Savings interest", "interest paid", "Interest Earned");

  // Bank activity, month by month, up to today.
  const rand = rng(20261118);
  const amount = (lo: number, hi: number) => -Math.round((lo + rand() * (hi - lo)) * 100);
  const checking: Row[] = [];
  const card: Row[] = [];
  const savings: Row[] = [];
  const payment = savedLoan.paymentCents;
  for (let m = startMonth; m <= tm - 1; m++) {
    const d = (n: number) => day(ty, m, n);
    checking.push(
      [d(1), 245_000, "ACME PAYROLL DIRECT DEP"],
      [d(15), 245_000, "ACME PAYROLL DIRECT DEP"],
      [d(2), -165_000, "OAK STREET RENT ACH"],
      [d(10), amount(85, 140), "CITY POWER UTILITY"],
      [d(12), -7_999, "FIBERLINK INTERNET"],
      [d(15), -payment, "AUTO LOAN PAYMENT"],
      [d(16), -50_000, "TRANSFER TO SAVINGS"],
      [d(25), -90_000, "CREDIT CARD PAYMENT"],
    );
    savings.push(
      [d(17), 50_000, "TRANSFER FROM CHECKING"],
      [d(28), 1_150 + Math.round(rand() * 300), "INTEREST PAID"],
    );
    card.push([d(26), 90_000, "PAYMENT THANK YOU"], [d(8), -1_549, "NETFLIX.COM"]);
    for (const n of [3, 10, 17, 24]) card.push([d(n), amount(55, 185), "FRESH MARKET #204"]);
    for (const n of [6, 20]) card.push([d(n), amount(32, 62), "SHELL OIL 5741"]);
    for (const n of [5, 13, 22]) card.push([d(n), amount(6, 24), "CORNER CAFE"]);
  }
  const upTo = (list: Row[]) => list.filter(([date]) => date <= today && date >= start);
  const importRows = async (accountId: string, list: Row[]) =>
    importCsv(db, actor, bookId, {
      accountId,
      mapping: {
        dateColumn: 0,
        dateFormat: "YYYY-MM-DD",
        descriptionColumn: 1,
        amountMode: "signed",
        amountColumn: 2,
      },
      rows: upTo(list).map(([postedDate, amountCents, description], i) => ({
        line: i + 2,
        postedDate,
        amountCents,
        description,
        payee: null,
        memo: null,
      })),
    });
  await importRows(id("Checking"), checking);
  await importRows(id("Credit Card"), card);
  await importRows(id("Savings"), savings);

  // Approve everything older than ten days, the way a weekly sit-down would.
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - 10 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (let guard = 0; guard < 400; guard++) {
    const queue = (await listQueue(db, actor.userId, bookId, "review")).filter(
      (q) => q.postedDate <= cutoff,
    );
    const item = queue[0];
    if (!item) break;
    if (item.transfer && item.transfer.bookId === bookId) {
      await approveTransfer(db, actor, bookId, item.id, { partnerId: item.transfer.id });
    } else if (item.description === "AUTO LOAN PAYMENT") {
      const [hint] = await loanHints(db, bookId);
      const split = splitPayment(-item.amountCents, hint!.owedCents, hint!.rateMicro);
      await approveItem(db, actor, bookId, item.id, {
        payee: "Valley Credit Union",
        splits: [
          { accountId: loan.id, amount: formatCents(split.principalCents, { showSymbol: false }) },
          {
            accountId: id("Interest Paid"),
            amount: formatCents(split.interestCents, { showSymbol: false }),
          },
        ],
      });
    } else if (item.suggestedAccountId) {
      await approveItem(db, actor, bookId, item.id, {});
    } else {
      // Nothing suggests a category: set it aside so the loop moves on.
      await excludeItem(db, actor, bookId, item.id);
    }
  }

  // A budget for each month.
  const budget = {
    [id("Paychecks")]: "4,900",
    [id("Rent or Mortgage")]: "1,650",
    [id("Groceries")]: "520",
    [id("Dining Out")]: "60",
    [id("Fuel")]: "110",
    [id("Utilities")]: "130",
    [id("Internet and Phone")]: "80",
    [id("Subscriptions")]: "20",
  };
  for (let m = startMonth; m <= tm - 1; m++) {
    await saveBudget(db, actor, bookId, day(ty, m, 1).slice(0, 7), budget);
  }
  return { bookId };
}
