import { describe, expect, it } from "vitest";
import {
  type AccountLike,
  accountPath,
  buildAccountTree,
  descendantIds,
  flattenTree,
} from "@/lib/account-tree";

function acct(
  id: string,
  name: string,
  type: string,
  parentAccountId: string | null = null,
  extra: Partial<AccountLike> = {},
): AccountLike {
  return { id, name, type, parentAccountId, code: null, sortOrder: 0, archivedAt: null, ...extra };
}

const rows: AccountLike[] = [
  acct("home", "Home", "expense"),
  acct("util", "Utilities", "expense", "home"),
  acct("power", "Electric", "expense", "util"),
  acct("rent", "Rent", "expense", "home"),
  acct("food", "Food", "expense"),
  acct("old", "Old Stuff", "expense", null, { archivedAt: new Date() }),
  acct("chk", "Checking", "asset", null, { code: "1010" }),
  acct("sav", "Savings", "asset", null, { code: "1020" }),
  acct("cash", "Cash", "asset"),
];

describe("buildAccountTree", () => {
  const tree = buildAccountTree(rows);

  it("groups top-level accounts by type", () => {
    expect(tree.expense.map((n) => n.id)).toEqual(["food", "home", "old"]);
    expect(tree.liability).toEqual([]);
  });

  it("sorts numbered accounts first, then by name", () => {
    expect(tree.asset.map((n) => n.name)).toEqual(["Checking", "Savings", "Cash"]);
  });

  it("nests without a depth limit and records depth", () => {
    const home = tree.expense.find((n) => n.id === "home")!;
    expect(home.children.map((n) => n.name)).toEqual(["Rent", "Utilities"]);
    const util = home.children.find((n) => n.id === "util")!;
    expect(util.children[0]!.name).toBe("Electric");
    expect(util.children[0]!.depth).toBe(2);
  });

  it("keeps an account whose parent is missing instead of losing it", () => {
    const t = buildAccountTree([acct("orphan", "Orphan", "income", "missing")]);
    expect(t.income.map((n) => n.id)).toEqual(["orphan"]);
  });
});

describe("flattenTree", () => {
  it("lists depth first and hides archived by default", () => {
    const flat = flattenTree(buildAccountTree(rows).expense);
    expect(flat.map((n) => n.id)).toEqual(["food", "home", "rent", "util", "power"]);
  });

  it("can include archived accounts", () => {
    const flat = flattenTree(buildAccountTree(rows).expense, { includeArchived: true });
    expect(flat.map((n) => n.id)).toContain("old");
  });
});

describe("descendantIds and accountPath", () => {
  it("finds all descendants", () => {
    expect([...descendantIds(rows, "home")].sort()).toEqual(["power", "rent", "util"]);
    expect(descendantIds(rows, "food").size).toBe(0);
  });

  it("builds a readable path", () => {
    expect(accountPath(rows, "power")).toEqual(["Home", "Utilities", "Electric"]);
  });

  it("survives a corrupted cycle without looping forever", () => {
    const loop = [acct("a", "A", "expense", "b"), acct("b", "B", "expense", "a")];
    expect(accountPath(loop, "a")).toEqual(["B", "A"]);
    expect([...descendantIds(loop, "a")].sort()).toEqual(["a", "b"]);
  });
});
