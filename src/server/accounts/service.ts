import { and, eq } from "drizzle-orm";
import type { AccountType } from "@/lib/account-types";
import { recordAudit } from "../audit/record";
import { accountHasActivity, accountNetCents } from "../ledger/queries";
import { formatCents } from "@/lib/money";
import type { Database, DbOrTx } from "../db/client";
import { accounts } from "../db/schema";
import { NotFoundError, pgErrorInfo, UserFacingError } from "../errors";
import {
  type AccountInput,
  assertCanArchive,
  assertCanChangeSystemFields,
  assertCanChangeType,
  assertCanDelete,
  assertCanUnarchive,
  assertValidParent,
  parseAccountInput,
} from "./rules";
import type { ChartTemplate, TemplateAccount } from "./templates";

export type AccountRow = typeof accounts.$inferSelect;

type Actor = { userId: string };

export async function listAccounts(db: DbOrTx, bookId: string): Promise<AccountRow[]> {
  return db.select().from(accounts).where(eq(accounts.bookId, bookId));
}

export async function getAccount(
  db: DbOrTx,
  bookId: string,
  accountId: string,
): Promise<AccountRow> {
  const rows = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError("That account");
  return rows[0];
}

export { accountHasActivity };

function friendlyConstraintError(
  err: unknown,
  input: { name: string; code: string | null },
): never {
  const { code, constraint } = pgErrorInfo(err);
  if (code === "23505" && constraint === "accounts_book_code_key") {
    throw new UserFacingError(`Another account already uses number ${input.code}.`, "code");
  }
  if (code === "23505" && constraint === "accounts_sibling_name_key") {
    throw new UserFacingError(
      `There's already an account named "${input.name}" in that spot.`,
      "name",
    );
  }
  throw err;
}

export async function createAccount(
  db: Database,
  actor: Actor,
  bookId: string,
  raw: unknown,
): Promise<AccountRow> {
  const input = parseAccountInput(raw);
  try {
    return await db.transaction(async (tx) => {
      const all = await listAccounts(tx, bookId);
      assertValidParent({ type: input.type, parentId: input.parentAccountId, all });
      const [row] = await tx
        .insert(accounts)
        .values({
          bookId,
          parentAccountId: input.parentAccountId,
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          subtype: input.subtype,
        })
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: row!.id,
        action: "create",
        after: row,
      });
      return row!;
    });
  } catch (err) {
    friendlyConstraintError(err, input);
  }
}

export async function updateAccount(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  raw: unknown,
): Promise<AccountRow> {
  const input: AccountInput = parseAccountInput(raw);
  try {
    return await db.transaction(async (tx) => {
      const all = await listAccounts(tx, bookId);
      const before = all.find((a) => a.id === accountId);
      if (!before) throw new NotFoundError("That account");
      assertCanChangeType(before, input.type, all);
      if (before.type !== input.type && (await accountHasActivity(tx, accountId))) {
        throw new UserFacingError(
          "This account has transactions, so its type can't change. Create a new account and move the balance instead.",
          "type",
        );
      }
      assertCanChangeSystemFields(before, input);
      if (before.isSystem && input.subtype !== before.subtype) {
        throw new UserFacingError("System accounts keep their detail type.", "subtype");
      }
      assertValidParent({ accountId, type: input.type, parentId: input.parentAccountId, all });
      const [after] = await tx
        .update(accounts)
        .set({
          parentAccountId: input.parentAccountId,
          code: input.code,
          name: input.name,
          description: input.description,
          type: input.type,
          subtype: input.subtype,
        })
        .where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)))
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: accountId,
        action: "update",
        before,
        after,
      });
      return after!;
    });
  } catch (err) {
    friendlyConstraintError(err, input);
  }
}

async function setArchived(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  archive: boolean,
): Promise<AccountRow> {
  return db.transaction(async (tx) => {
    const all = await listAccounts(tx, bookId);
    const before = all.find((a) => a.id === accountId);
    if (!before) throw new NotFoundError("That account");
    if (archive) {
      assertCanArchive(before, all);
      const net = await accountNetCents(tx, accountId);
      if (net !== 0) {
        throw new UserFacingError(
          `${before.name} has a balance of ${formatCents(Math.abs(net))}. Move it to another account with a journal entry before archiving.`,
        );
      }
    } else assertCanUnarchive(before, all);
    const [after] = await tx
      .update(accounts)
      .set({ archivedAt: archive ? new Date() : null })
      .where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)))
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "account",
      entityId: accountId,
      action: archive ? "archive" : "unarchive",
      before,
      after,
    });
    return after!;
  });
}

export const archiveAccount = (db: Database, actor: Actor, bookId: string, accountId: string) =>
  setArchived(db, actor, bookId, accountId, true);

export const unarchiveAccount = (db: Database, actor: Actor, bookId: string, accountId: string) =>
  setArchived(db, actor, bookId, accountId, false);

export async function deleteAccount(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const all = await listAccounts(tx, bookId);
    const before = all.find((a) => a.id === accountId);
    if (!before) throw new NotFoundError("That account");
    assertCanDelete(before, all, await accountHasActivity(tx, accountId));
    await tx.delete(accounts).where(and(eq(accounts.bookId, bookId), eq(accounts.id, accountId)));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "account",
      entityId: accountId,
      action: "delete",
      before,
    });
  });
}

/** Inserts a template's accounts (with nesting) into a new book. Runs inside the caller's transaction. */
export async function insertTemplateAccounts(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  template: ChartTemplate,
): Promise<number> {
  let count = 0;
  const insertLevel = async (
    list: TemplateAccount[],
    type: AccountType,
    parentAccountId: string | null,
  ): Promise<void> => {
    for (const [index, item] of list.entries()) {
      const [row] = await tx
        .insert(accounts)
        .values({
          bookId,
          parentAccountId,
          code: item.code ?? null,
          name: item.name,
          description: item.description ?? null,
          type,
          subtype: item.subtype,
          isSystem: Boolean(item.systemRole),
          systemRole: item.systemRole ?? null,
          sortOrder: index,
        })
        .returning();
      count += 1;
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: row!.id,
        action: "create",
        after: { ...row, source: `template:${template.id}` },
      });
      if (item.children?.length) await insertLevel(item.children, type, row!.id);
    }
  };
  for (const [type, list] of Object.entries(template.accounts) as [
    AccountType,
    TemplateAccount[],
  ][]) {
    await insertLevel(list, type, null);
  }
  return count;
}
