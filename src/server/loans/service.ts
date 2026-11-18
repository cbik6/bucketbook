import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { amortize, levelPayment, parseRate, splitPayment } from "@/lib/loans";
import { parseCents } from "@/lib/money";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { accounts, loans } from "../db/schema";
import { NotFoundError, UserFacingError, pgErrorInfo } from "../errors";
import { accountNetCents } from "../ledger/queries";

type Actor = { userId: string };

export type LoanRow = typeof loans.$inferSelect;

const loanSchema = z.object({
  accountId: z.uuid("Pick the loan's liability account."),
  interestAccountId: z.uuid("Pick the expense account for interest."),
  principal: z.string().trim().min(1, "Enter the amount borrowed."),
  rate: z.string().trim().min(1, "Enter the interest rate."),
  termMonths: z.coerce.number().int("Enter whole months.").min(1).max(600),
  firstPaymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the first payment date."),
  payment: z.string().trim().default(""),
});

async function parseLoan(db: DbOrTx, bookId: string, raw: unknown) {
  const parsed = loanSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const v = parsed.data;
  let principalCents: number;
  try {
    principalCents = parseCents(v.principal);
  } catch {
    throw new UserFacingError("Enter the amount like 25,000.", "principal");
  }
  if (principalCents <= 0) throw new UserFacingError("The amount must be above zero.", "principal");
  const rateMicro = parseRate(v.rate);
  if (rateMicro === null)
    throw new UserFacingError("Enter the rate like 6.5 (up to 4 decimals).", "rate");
  let paymentCents = levelPayment(principalCents, rateMicro, v.termMonths);
  if (v.payment) {
    try {
      paymentCents = parseCents(v.payment);
    } catch {
      throw new UserFacingError("Enter the payment like 470.64, or leave it blank.", "payment");
    }
  }
  try {
    amortize({
      principalCents,
      rateMicro,
      months: v.termMonths,
      paymentCents,
      firstPaymentDate: v.firstPaymentDate,
    });
  } catch (err) {
    throw new UserFacingError((err as Error).message, "payment");
  }
  const rows = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const acct = rows.find((a) => a.id === v.accountId);
  const interest = rows.find((a) => a.id === v.interestAccountId);
  if (!acct || acct.type !== "liability" || !acct.allowsPosting) {
    throw new UserFacingError("Pick a liability account that takes postings.", "accountId");
  }
  if (!interest || interest.type !== "expense" || !interest.allowsPosting) {
    throw new UserFacingError("Pick an expense account for the interest.", "interestAccountId");
  }
  return {
    accountId: acct.id,
    interestAccountId: interest.id,
    principalCents,
    annualRateMicro: rateMicro,
    termMonths: v.termMonths,
    firstPaymentDate: v.firstPaymentDate,
    paymentCents,
  };
}

export async function saveLoan(
  db: Database,
  actor: Actor,
  bookId: string,
  loanId: string | null,
  raw: unknown,
) {
  const values = await parseLoan(db, bookId, raw);
  try {
    return await db.transaction(async (tx) => {
      if (loanId) {
        const before = await loadLoan(tx, bookId, loanId);
        const [after] = await tx.update(loans).set(values).where(eq(loans.id, loanId)).returning();
        await recordAudit(tx, {
          bookId,
          userId: actor.userId,
          entityType: "loan",
          entityId: loanId,
          action: "update",
          before,
          after,
        });
        return after!;
      }
      const [row] = await tx
        .insert(loans)
        .values({ bookId, ...values })
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "loan",
        entityId: row!.id,
        action: "create",
        after: row,
      });
      return row!;
    });
  } catch (err) {
    if (pgErrorInfo(err).constraint === "loans_account_key") {
      throw new UserFacingError("That account already has a loan set up.", "accountId");
    }
    throw err;
  }
}

async function loadLoan(db: DbOrTx, bookId: string, loanId: string) {
  if (!z.uuid().safeParse(loanId).success) throw new NotFoundError("That loan");
  const [row] = await db
    .select()
    .from(loans)
    .where(and(eq(loans.id, loanId), eq(loans.bookId, bookId)));
  if (!row) throw new NotFoundError("That loan");
  return row;
}

export async function deleteLoan(db: Database, actor: Actor, bookId: string, loanId: string) {
  const before = await loadLoan(db, bookId, loanId);
  await db.transaction(async (tx) => {
    await tx.delete(loans).where(eq(loans.id, loanId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "loan",
      entityId: loanId,
      action: "delete",
      before,
    });
  });
}

export type LoanView = LoanRow & {
  accountName: string;
  interestAccountName: string;
  /** What the books say is owed now (positive). */
  owedCents: number;
};

export async function listLoans(db: DbOrTx, bookId: string): Promise<LoanView[]> {
  const rows = await db
    .select({ loan: loans, accountName: accounts.name })
    .from(loans)
    .innerJoin(accounts, eq(accounts.id, loans.accountId))
    .where(eq(loans.bookId, bookId))
    .orderBy(asc(loans.createdAt));
  const all = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(eq(accounts.bookId, bookId));
  const out: LoanView[] = [];
  for (const r of rows) {
    out.push({
      ...r.loan,
      accountName: r.accountName,
      interestAccountName: all.find((a) => a.id === r.loan.interestAccountId)?.name ?? "",
      owedCents: -(await accountNetCents(db, r.loan.accountId)),
    });
  }
  return out;
}

/** For the review queue: how to split a payment to each loan account. */
export async function loanHints(db: DbOrTx, bookId: string) {
  const list = await listLoans(db, bookId);
  return list.map((l) => ({
    accountId: l.accountId,
    interestAccountId: l.interestAccountId,
    rateMicro: l.annualRateMicro,
    owedCents: l.owedCents,
  }));
}

export { splitPayment };
