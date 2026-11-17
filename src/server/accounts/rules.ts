import { z } from "zod";
import {
  ACCOUNT_TYPE_SINGULAR,
  type AccountType,
  isAccountType,
  isSubtypeOf,
} from "@/lib/account-types";
import { descendantIds } from "@/lib/account-tree";
import { UserFacingError } from "../errors";

/**
 * Pure business rules for the chart of accounts. No database access here, so
 * every rule is easy to unit test.
 */

export const accountInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Give the account a name.")
      .max(100, "Keep the name under 100 characters."),
    code: z
      .string()
      .trim()
      .max(20, "Keep the number under 20 characters.")
      .regex(/^[A-Za-z0-9.]*$/, "Use only letters, digits and periods in the account number.")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
    type: z.string().refine(isAccountType, "Pick an account type."),
    subtype: z.string().min(1, "Pick a detail type."),
    parentAccountId: z
      .string()
      .transform((v) => (v === "" ? null : v))
      .pipe(z.uuid("Pick a valid parent account.").nullable())
      .nullable()
      .default(null),
    description: z
      .string()
      .trim()
      .max(500, "Keep the description under 500 characters.")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
  })
  .superRefine((value, ctx) => {
    if (isAccountType(value.type) && !isSubtypeOf(value.type, value.subtype)) {
      ctx.addIssue({
        code: "custom",
        path: ["subtype"],
        message: `That detail type doesn't belong to ${ACCOUNT_TYPE_SINGULAR[value.type]} accounts.`,
      });
    }
  });

export type AccountInput = Omit<z.infer<typeof accountInputSchema>, "type"> & { type: AccountType };

export function parseAccountInput(raw: unknown): AccountInput {
  const result = accountInputSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UserFacingError(issue.message, issue.path.join("."));
  }
  return result.data as AccountInput;
}

export type RuleAccount = {
  id: string;
  parentAccountId: string | null;
  code: string | null;
  name: string;
  type: string;
  sortOrder: number;
  archivedAt: Date | string | null;
  isSystem: boolean;
  isBucket: boolean;
  bucketsEnabled: boolean;
};

/** Checks a proposed parent for a new or existing account. Throws on failure. */
export function assertValidParent(args: {
  accountId?: string;
  type: AccountType;
  parentId: string | null;
  all: RuleAccount[];
}): void {
  const { accountId, type, parentId, all } = args;
  if (!parentId) return;
  const parent = all.find((a) => a.id === parentId);
  if (!parent)
    throw new UserFacingError("That parent account doesn't exist in this book.", "parentAccountId");
  if (accountId && parent.id === accountId) {
    throw new UserFacingError("An account can't be its own parent.", "parentAccountId");
  }
  if (accountId && descendantIds(all, accountId).has(parent.id)) {
    throw new UserFacingError(
      "That would put the account inside one of its own sub-accounts.",
      "parentAccountId",
    );
  }
  if (parent.type !== type) {
    throw new UserFacingError(
      `A sub-account must be the same type as its parent (${ACCOUNT_TYPE_SINGULAR[parent.type as AccountType]}).`,
      "parentAccountId",
    );
  }
  if (parent.archivedAt) {
    throw new UserFacingError(
      "You can't add accounts under an archived account.",
      "parentAccountId",
    );
  }
  if (parent.isBucket || parent.bucketsEnabled) {
    throw new UserFacingError(
      "Accounts with buckets are managed from the bucket screens.",
      "parentAccountId",
    );
  }
}

export function assertCanChangeType(
  account: RuleAccount,
  nextType: string,
  all: RuleAccount[],
): void {
  if (account.type === nextType) return;
  if (account.isSystem) throw new UserFacingError("System accounts can't change type.", "type");
  if (all.some((a) => a.parentAccountId === account.id)) {
    throw new UserFacingError(
      "Move or archive the sub-accounts before changing this account's type.",
      "type",
    );
  }
}

export function assertCanChangeSystemFields(account: RuleAccount, input: AccountInput): void {
  if (!account.isSystem) return;
  if (input.parentAccountId !== account.parentAccountId) {
    throw new UserFacingError("System accounts stay at the top level.", "parentAccountId");
  }
}

export function assertCanArchive(account: RuleAccount, all: RuleAccount[]): void {
  if (account.archivedAt) throw new UserFacingError("That account is already archived.");
  if (account.isSystem) {
    throw new UserFacingError(`${account.name} is used by the app and can't be archived.`);
  }
  const activeChildren = all.filter((a) => a.parentAccountId === account.id && !a.archivedAt);
  if (activeChildren.length > 0) {
    const names = activeChildren.map((c) => c.name).join(", ");
    throw new UserFacingError(`Archive its sub-accounts first: ${names}.`);
  }
}

export function assertCanUnarchive(account: RuleAccount, all: RuleAccount[]): void {
  if (!account.archivedAt) throw new UserFacingError("That account isn't archived.");
  const parent = account.parentAccountId
    ? all.find((a) => a.id === account.parentAccountId)
    : undefined;
  if (parent?.archivedAt) {
    throw new UserFacingError(`Restore its parent account (${parent.name}) first.`);
  }
}

export function assertCanDelete(
  account: RuleAccount,
  all: RuleAccount[],
  hasActivity: boolean,
): void {
  if (account.isSystem)
    throw new UserFacingError(`${account.name} is used by the app and can't be deleted.`);
  if (all.some((a) => a.parentAccountId === account.id)) {
    throw new UserFacingError("Delete or move its sub-accounts first.");
  }
  if (hasActivity) {
    throw new UserFacingError("This account has transactions, so it can only be archived.");
  }
}
