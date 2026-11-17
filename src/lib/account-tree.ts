import type { AccountType } from "./account-types";

/** The fields the tree needs; works for DB rows and for test fixtures. */
export type AccountLike = {
  id: string;
  parentAccountId: string | null;
  code: string | null;
  name: string;
  type: string;
  sortOrder: number;
  archivedAt: Date | string | null;
};

export type AccountNode<T extends AccountLike> = T & { children: AccountNode<T>[]; depth: number };

const collator = new Intl.Collator("en-US", { numeric: true, sensitivity: "base" });

/** Numbered accounts first (in number order), then by name. */
export function compareAccounts(a: AccountLike, b: AccountLike): number {
  if (a.code && b.code) {
    const byCode = collator.compare(a.code, b.code);
    if (byCode !== 0) return byCode;
  } else if (a.code) {
    return -1;
  } else if (b.code) {
    return 1;
  }
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  return a.sortOrder - b.sortOrder;
}

/**
 * Builds nested trees per account type. Accounts whose parent is missing from
 * the list (should not happen) are shown at the top level rather than lost.
 */
export function buildAccountTree<T extends AccountLike>(
  rows: T[],
): Record<AccountType, AccountNode<T>[]> {
  const nodes = new Map<string, AccountNode<T>>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [], depth: 0 });

  const roots: Record<AccountType, AccountNode<T>[]> = {
    asset: [],
    liability: [],
    equity: [],
    income: [],
    expense: [],
  };

  for (const node of nodes.values()) {
    const parent = node.parentAccountId ? nodes.get(node.parentAccountId) : undefined;
    if (parent) parent.children.push(node);
    else roots[node.type as AccountType]?.push(node);
  }

  const sortAndDepth = (list: AccountNode<T>[], depth: number) => {
    list.sort(compareAccounts);
    for (const n of list) {
      n.depth = depth;
      sortAndDepth(n.children, depth + 1);
    }
  };
  for (const list of Object.values(roots)) sortAndDepth(list, 0);
  return roots;
}

/** Depth-first list for rendering a table, optionally hiding archived accounts. */
export function flattenTree<T extends AccountLike>(
  roots: AccountNode<T>[],
  options: { includeArchived?: boolean } = {},
): AccountNode<T>[] {
  const out: AccountNode<T>[] = [];
  const walk = (list: AccountNode<T>[]) => {
    for (const n of list) {
      if (!options.includeArchived && n.archivedAt) continue;
      out.push(n);
      walk(n.children);
    }
  };
  walk(roots);
  return out;
}

/** All descendant ids of an account (not including itself). */
export function descendantIds(rows: AccountLike[], accountId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.parentAccountId) continue;
    const list = childrenOf.get(r.parentAccountId) ?? [];
    list.push(r.id);
    childrenOf.set(r.parentAccountId, list);
  }
  const result = new Set<string>();
  const stack = [...(childrenOf.get(accountId) ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return result;
}

/** "Expenses : Home : Utilities" style path, for selects and breadcrumbs. */
export function accountPath(rows: AccountLike[], accountId: string): string[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const path: string[] = [];
  let current = byId.get(accountId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current.name);
    current = current.parentAccountId ? byId.get(current.parentAccountId) : undefined;
  }
  return path;
}
