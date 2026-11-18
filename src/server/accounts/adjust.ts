import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { formatDay } from "@/lib/dates";
import { formatCents, parseCents } from "@/lib/money";
import type { Database } from "../db/client";
import { accounts } from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";
import { accountTotals } from "../ledger/queries";
import {
  assertDateAllowed,
  createEntry,
  loadBookForPosting,
  validateLines,
} from "../ledger/service";

type Actor = { userId: string };

const schema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  balance: z.string().trim().min(1, "Enter the new balance."),
  offsetAccountId: z.uuid("Pick where the change goes."),
  memo: z.string().trim().max(500).default(""),
});

/**
 * For accounts no bank reports (cash, a car's value, a loan at an unsupported
 * lender): you type what it is worth or owed on a date, and the difference is
 * posted against the account you pick (for example a gain or loss account).
 */
export async function recordBalance(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  raw: unknown,
) {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;
  let natural: number;
  try {
    natural = parseCents(input.balance);
  } catch {
    throw new UserFacingError("Enter the balance like 12,500.", "balance");
  }
  if (!z.uuid().safeParse(accountId).success) throw new NotFoundError("That account");
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    assertDateAllowed(input.date, book.startDate);
    const [acct] = await tx
      .select()
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.bookId, bookId)));
    if (!acct) throw new NotFoundError("That account");
    if (acct.type !== "asset" && acct.type !== "liability") {
      throw new UserFacingError("Balances can be recorded for asset and liability accounts.");
    }
    if (input.offsetAccountId === acct.id) {
      throw new UserFacingError("Pick a different account for the change.", "offsetAccountId");
    }
    const totals = await accountTotals(tx, bookId, { asOf: input.date });
    const t = totals.get(acct.id);
    const net = t ? t.debitCents - t.creditCents : 0;
    const targetNet = acct.type === "liability" ? -natural : natural;
    const diff = targetNet - net;
    if (diff === 0) {
      throw new UserFacingError(
        `${acct.name} already shows ${formatCents(natural)} on ${formatDay(input.date)}.`,
        "balance",
      );
    }
    const amount = formatCents(Math.abs(diff), { showSymbol: false });
    const lines = await validateLines(tx, bookId, [
      {
        accountId: acct.id,
        debit: diff > 0 ? amount : "",
        credit: diff < 0 ? amount : "",
        memo: "",
      },
      {
        accountId: input.offsetAccountId,
        debit: diff < 0 ? amount : "",
        credit: diff > 0 ? amount : "",
        memo: "",
      },
    ]);
    return createEntry(tx, {
      actor,
      bookId,
      kind: "manual",
      entryDate: input.date,
      memo: input.memo || `Balance update: ${acct.name} is ${formatCents(natural)}`,
      lines,
      changeNote: "Created from a balance update",
    });
  });
}
