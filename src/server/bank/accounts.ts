import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { DbOrTx } from "../db/client";
import { accounts } from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";

/**
 * Accounts that bank data can land on: asset and liability accounts you can
 * post to (checking, savings, cash, credit cards, loans). System accounts and
 * buckets are left out. An account with buckets turned on joins in Phase 4,
 * when its deposits land in Unassigned.
 */
export async function bankableAccounts(db: DbOrTx, bookId: string) {
  return db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      subtype: accounts.subtype,
      parentAccountId: accounts.parentAccountId,
    })
    .from(accounts)
    .where(
      and(
        eq(accounts.bookId, bookId),
        inArray(accounts.type, ["asset", "liability"]),
        eq(accounts.allowsPosting, true),
        eq(accounts.isBucket, false),
        isNull(accounts.systemRole),
        isNull(accounts.archivedAt),
      ),
    )
    .orderBy(asc(accounts.type), asc(accounts.sortOrder), asc(accounts.name));
}

export async function requireBankableAccount(db: DbOrTx, bookId: string, accountId: string) {
  const list = await bankableAccounts(db, bookId);
  const found = list.find((a) => a.id === accountId);
  if (found) return found;
  const [any] = await db
    .select({ id: accounts.id, name: accounts.name })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)))
    .catch(() => []);
  if (!any) throw new NotFoundError("That account");
  throw new UserFacingError(
    `${any.name} can't hold bank transactions. Pick a bank, cash, credit card or loan account.`,
    "accountId",
  );
}
