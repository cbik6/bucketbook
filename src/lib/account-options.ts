import { type AccountLike, buildAccountTree, flattenTree } from "./account-tree";
import { ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS, type AccountType } from "./account-types";

export type AccountOption = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  depth: number;
  /** Shown but not selectable (archived, or holds buckets). */
  disabled: boolean;
};

export type AccountOptionGroup = { type: AccountType; label: string; options: AccountOption[] };

type Row = AccountLike & { allowsPosting: boolean };

/**
 * Accounts for a picker, grouped by type in chart order with nesting depth.
 * Archived accounts are left out unless listed in `keepIds` (for example,
 * accounts already used on an entry being edited).
 */
export function accountOptionGroups(rows: Row[], keepIds: string[] = []): AccountOptionGroup[] {
  const keep = new Set(keepIds);
  const tree = buildAccountTree(rows);
  return ACCOUNT_TYPES.map((type) => ({
    type,
    label: ACCOUNT_TYPE_LABELS[type],
    options: flattenTree(tree[type], { includeArchived: true })
      .filter((n) => !n.archivedAt || keep.has(n.id))
      .map((n) => ({
        id: n.id,
        name: n.name,
        code: n.code,
        type,
        depth: n.depth,
        disabled: Boolean(n.archivedAt) || !n.allowsPosting,
      })),
  })).filter((g) => g.options.length > 0);
}
