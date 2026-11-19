import { type AccountLike, accountPath, buildAccountTree, flattenTree } from "./account-tree";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "./account-types";

export type AccountOption = {
  id: string;
  name: string;
  /** Name with its parents, for example "Food: Groceries", so every option starts flush. */
  label: string;
  code: string | null;
  type: AccountType;
  depth: number;
  /** Shown but not selectable (archived, holds buckets, or a parent the book keeps as a heading). */
  disabled: boolean;
  /** Has sub-accounts (buckets don't count). */
  isParent: boolean;
};

export type AccountOptionGroup = { type: AccountType; label: string; options: AccountOption[] };

type Row = AccountLike & { allowsPosting: boolean; isBucket?: boolean };

/**
 * Accounts for a picker, grouped by type in chart order with nesting depth.
 * Archived accounts are left out unless listed in `keepIds` (for example,
 * accounts already used on an entry being edited).
 */
export function accountOptionGroups(
  rows: Row[],
  keepIds: string[] = [],
  options: { blockParents?: boolean } = {},
): AccountOptionGroup[] {
  const keep = new Set(keepIds);
  const parents = new Set(
    rows.filter((r) => r.parentAccountId && !r.isBucket).map((r) => r.parentAccountId!),
  );
  const tree = buildAccountTree(rows);
  return ACCOUNT_TYPES.map((type) => ({
    type,
    label: ACCOUNT_TYPE_LABELS[type],
    options: flattenTree(tree[type], { includeArchived: true })
      .filter((n) => !n.archivedAt || keep.has(n.id))
      .map((n) => ({
        id: n.id,
        name: n.name,
        label: accountPath(rows, n.id).join(": "),
        code: n.code,
        type,
        depth: n.depth,
        isParent: parents.has(n.id),
        disabled:
          Boolean(n.archivedAt) ||
          !n.allowsPosting ||
          (Boolean(options.blockParents) && parents.has(n.id)),
      })),
  })).filter((g) => g.options.length > 0);
}
