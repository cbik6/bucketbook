import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { listQueue } from "@/server/bank/review-service";
import { bucketOverview } from "@/server/buckets/service";
import { getDb } from "@/server/db/client";
import { createDemoBook } from "@/server/demo/seed";
import { listLoans } from "@/server/loans/service";
import { balanceSheet, budgetVsActual, profitAndLoss } from "@/server/reports/service";
import { makeUser, setupCleanDatabase } from "./helpers";

setupCleanDatabase();

describe("demo book", () => {
  it("builds months of consistent activity with every feature in use", async () => {
    const user = await makeUser();
    const today = "2026-11-18";
    const { bookId } = await createDemoBook(getDb(), { userId: user.id }, today);

    // Double entry holds across the whole book.
    const totals = await getDb().execute<{ d: string; c: string }>(sql`
      select sum(debit_cents)::text as d, sum(credit_cents)::text as c from ledger_lines where book_id = ${bookId}
    `);
    expect(totals.rows[0]!.d).toBe(totals.rows[0]!.c);
    const bs = await balanceSheet(getDb(), bookId, today);
    expect(bs.outOfBalanceCents).toBe(0);

    // Buckets add up to their account, and allocations happened.
    const { accounts } = await bucketOverview(getDb(), bookId);
    const savings = accounts[0]!;
    expect(savings.buckets.reduce((n, b) => n + b.balanceCents, 0)).toBe(savings.totalCents);
    expect(savings.buckets.find((b) => b.name === "Vacation")!.balanceCents).toBeGreaterThan(
      100_000,
    );

    // Loan payments were split, so the loan went down.
    const [loan] = await listLoans(getDb(), bookId);
    expect(loan!.owedCents).toBeLessThan(1_800_000);
    expect(loan!.owedCents).toBeGreaterThan(1_600_000);

    // Recent days are waiting for review, with suggestions ready.
    const queue = await listQueue(getDb(), user.id, bookId, "review");
    expect(queue.length).toBeGreaterThan(3);
    expect(queue.some((q) => q.suggestedAccountId || q.transfer)).toBe(true);

    const pl = await profitAndLoss(getDb(), bookId, { from: "2026-08-01", to: today });
    expect(pl.incomeCents).toBeGreaterThan(pl.expenseCents);
    const bva = await budgetVsActual(getDb(), bookId, { from: "2026-10-01", to: "2026-10-31" });
    expect(bva.expense.budget).toBeGreaterThan(0);
  });
});
