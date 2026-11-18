import { describe, expect, it } from "vitest";
import { recordBalance } from "@/server/accounts/adjust";
import { createAccount, listAccounts } from "@/server/accounts/service";
import { createBook } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { accountNetCents } from "@/server/ledger/queries";
import { editEntry, postEntry, reverseEntry, saveOpeningBalances } from "@/server/ledger/service";
import { listLoans, loanHints, saveLoan } from "@/server/loans/service";
import {
  discardReconciliation,
  finishReconciliation,
  reconciliationState,
  setCleared,
  startReconciliation,
  undoReconciliation,
} from "@/server/reconcile/service";
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
  const rows = await listAccounts(getDb(), book.id);
  const id = (name: string) => rows.find((a) => a.name === name)!.id;
  return { actor, bookId: book.id, id };
}

const spend = (
  ctx: Awaited<ReturnType<typeof setup>>,
  date: string,
  amount: string,
  from = "Checking",
) =>
  postEntry(getDb(), ctx.actor, ctx.bookId, {
    entryDate: date,
    memo: `Spend ${amount}`,
    lines: [
      { accountId: ctx.id("Groceries"), debit: amount, credit: "", memo: "" },
      { accountId: ctx.id(from), debit: "", credit: amount, memo: "" },
    ],
  });

describe("reconciliation", () => {
  it("clears items until the difference is zero, then locks them behind a confirmation", async () => {
    const ctx = await setup();
    await saveOpeningBalances(getDb(), ctx.actor, ctx.bookId, { [ctx.id("Checking")]: "1,000" });
    const a = await spend(ctx, "2026-01-05", "100");
    await spend(ctx, "2026-01-20", "50");
    const late = await spend(ctx, "2026-02-03", "25");

    const rec = await startReconciliation(getDb(), ctx.actor, ctx.bookId, {
      accountId: ctx.id("Checking"),
      statementDate: "2026-01-31",
      statementBalance: "900",
    });
    let state = await reconciliationState(getDb(), ctx.bookId, rec.id);
    // The February entry is after the statement date, so it isn't offered.
    expect(state.items.map((i) => i.entryId)).not.toContain(late.id);
    expect(state.items).toHaveLength(3);
    expect(state.differenceCents).toBe(90_000);

    const opening = state.items.find((i) => i.amountCents === 100_000)!;
    await setCleared(getDb(), ctx.bookId, rec.id, [opening.entryId, a.id], true);
    state = await reconciliationState(getDb(), ctx.bookId, rec.id);
    expect(state.differenceCents).toBe(0);
    await finishReconciliation(getDb(), ctx.actor, ctx.bookId, rec.id);

    // Editing a reconciled entry needs a confirming tick.
    const edit = {
      entryDate: "2026-01-05",
      memo: "Spend 100",
      lines: [
        { accountId: ctx.id("Dining Out"), debit: "100", credit: "", memo: "" },
        { accountId: ctx.id("Checking"), debit: "", credit: "100", memo: "" },
      ],
    };
    await expect(editEntry(getDb(), ctx.actor, ctx.bookId, a.id, edit)).rejects.toThrow(
      /reconciled on the Checking statement/,
    );
    await editEntry(getDb(), ctx.actor, ctx.bookId, a.id, { ...edit, confirmReconciled: true });
    await expect(
      reverseEntry(getDb(), ctx.actor, ctx.bookId, a.id, { entryDate: "2026-02-01" }),
    ).rejects.toThrow(/reconciled/);

    // The next statement starts from this one's balance and doesn't offer cleared items.
    const next = await startReconciliation(getDb(), ctx.actor, ctx.bookId, {
      accountId: ctx.id("Checking"),
      statementDate: "2026-02-28",
      statementBalance: "825",
    });
    const s2 = await reconciliationState(getDb(), ctx.bookId, next.id);
    expect(s2.rec.beginningBalanceCents).toBe(90_000);
    expect(s2.items.map((i) => i.amountCents).sort((x, y) => x - y)).toEqual([-5_000, -2_500]);
    await discardReconciliation(getDb(), ctx.actor, ctx.bookId, next.id);
    await undoReconciliation(getDb(), ctx.actor, ctx.bookId, rec.id);
    expect((await reconciliationState(getDb(), ctx.bookId, rec.id)).rec.status).toBe("open");
  });

  it("refuses to finish with a difference, and uses statement signs for cards", async () => {
    const ctx = await setup();
    await spend(ctx, "2026-01-05", "40", "Credit Card");
    const rec = await startReconciliation(getDb(), ctx.actor, ctx.bookId, {
      accountId: ctx.id("Credit Card"),
      statementDate: "2026-01-31",
      statementBalance: "40",
    });
    let state = await reconciliationState(getDb(), ctx.bookId, rec.id);
    expect(state.rec.statementBalanceCents).toBe(-4_000);
    await expect(finishReconciliation(getDb(), ctx.actor, ctx.bookId, rec.id)).rejects.toThrow(
      /difference is zero/,
    );
    await setCleared(getDb(), ctx.bookId, rec.id, [state.items[0]!.entryId], true);
    state = await reconciliationState(getDb(), ctx.bookId, rec.id);
    expect(state.differenceCents).toBe(0);
    await expect(
      startReconciliation(getDb(), ctx.actor, ctx.bookId, {
        accountId: ctx.id("Credit Card"),
        statementDate: "2026-02-28",
        statementBalance: "0",
      }),
    ).rejects.toThrow(/in progress/);
  });
});

describe("loans", () => {
  it("stores a loan with the standard payment and reports what is owed", async () => {
    const ctx = await setup();
    const loanAcct = await createAccount(getDb(), ctx.actor, ctx.bookId, {
      name: "Car Loan",
      type: "liability",
      subtype: "loan",
    });
    const interest = await createAccount(getDb(), ctx.actor, ctx.bookId, {
      name: "Interest Paid",
      type: "expense",
      subtype: "expense",
    });
    await saveOpeningBalances(getDb(), ctx.actor, ctx.bookId, { [loanAcct.id]: "25,000" });
    const loan = await saveLoan(getDb(), ctx.actor, ctx.bookId, null, {
      accountId: loanAcct.id,
      interestAccountId: interest.id,
      principal: "25,000",
      rate: "4.9",
      termMonths: "60",
      firstPaymentDate: "2026-02-01",
    });
    expect(loan.paymentCents).toBe(47_064);
    const [view] = await listLoans(getDb(), ctx.bookId);
    expect(view!.owedCents).toBe(2_500_000);
    const [hint] = await loanHints(getDb(), ctx.bookId);
    expect(hint).toMatchObject({ rateMicro: 49_000, owedCents: 2_500_000 });
    await expect(
      saveLoan(getDb(), ctx.actor, ctx.bookId, null, {
        accountId: ctx.id("Groceries"),
        interestAccountId: interest.id,
        principal: "100",
        rate: "1",
        termMonths: "12",
        firstPaymentDate: "2026-02-01",
      }),
    ).rejects.toThrow(/liability account/);
  });
});

describe("balance updates", () => {
  it("posts the difference to bring a manual account to a new balance", async () => {
    const ctx = await setup();
    const car = await createAccount(getDb(), ctx.actor, ctx.bookId, {
      name: "Car",
      type: "asset",
      subtype: "fixed_asset",
    });
    await recordBalance(getDb(), ctx.actor, ctx.bookId, car.id, {
      date: "2026-01-01",
      balance: "20,000",
      offsetAccountId: ctx.id("Opening Balance Equity"),
    });
    await recordBalance(getDb(), ctx.actor, ctx.bookId, car.id, {
      date: "2026-06-01",
      balance: "18,500",
      offsetAccountId: ctx.id("Other Income"),
    });
    expect(await accountNetCents(getDb(), car.id)).toBe(1_850_000);
    await expect(
      recordBalance(getDb(), ctx.actor, ctx.bookId, car.id, {
        date: "2026-06-01",
        balance: "18,500",
        offsetAccountId: ctx.id("Other Income"),
      }),
    ).rejects.toThrow(/already shows/);
  });
});
