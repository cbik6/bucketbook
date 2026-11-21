import { and, eq } from "drizzle-orm";
import type { SystemRole } from "@/lib/account-types";
import type { DbOrTx } from "../db/client";
import { accounts } from "../db/schema";
import { UserFacingError } from "../errors";

const DEFAULTS: Record<SystemRole, { name: string; subtype: string; description: string }> = {
  opening_balance_equity: {
    name: "Opening Balance Equity",
    subtype: "opening_balance",
    description: "What your accounts held when you started tracking them.",
  },
  retained_earnings: {
    name: "Retained Earnings",
    subtype: "retained_earnings",
    description: "Past years' net income.",
  },
  unrealized_gains: {
    name: "Unrealized Gains and Losses",
    subtype: "other_equity",
    description: "Changes in the value of investments, kept out of income and spending.",
  },
};

/** The book's account for a system role, created the first time it is needed. */
export async function systemAccount(tx: DbOrTx, bookId: string, role: SystemRole): Promise<string> {
  const [found] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.systemRole, role)));
  if (found) return found.id;
  const d = DEFAULTS[role];
  const [row] = await tx
    .insert(accounts)
    .values({
      bookId,
      name: d.name,
      description: d.description,
      type: "equity",
      subtype: d.subtype,
      isSystem: true,
      systemRole: role,
      sortOrder: 900,
    })
    .onConflictDoNothing()
    .returning({ id: accounts.id });
  if (row) return row.id;
  const [again] = await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.systemRole, role)));
  if (!again) {
    throw new UserFacingError(
      `Bucketbook needs an account called ${d.name}, and another account already has that name. Rename it, then try again.`,
    );
  }
  return again.id;
}
