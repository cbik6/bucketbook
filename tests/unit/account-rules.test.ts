import { describe, expect, it } from "vitest";
import {
  type RuleAccount,
  assertCanArchive,
  assertCanChangeType,
  assertCanDelete,
  assertCanUnarchive,
  assertValidParent,
  parseAccountInput,
} from "@/server/accounts/rules";
import { UserFacingError } from "@/server/errors";

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function a(n: number, over: Partial<RuleAccount> = {}): RuleAccount {
  return {
    id: uuid(n),
    parentAccountId: null,
    code: null,
    name: `Account ${n}`,
    type: "expense",
    sortOrder: 0,
    archivedAt: null,
    isSystem: false,
    isBucket: false,
    bucketsEnabled: false,
    ...over,
  };
}

const home = a(1, { name: "Home" });
const utilities = a(2, { name: "Utilities", parentAccountId: uuid(1) });
const electric = a(3, { name: "Electric", parentAccountId: uuid(2) });
const checking = a(4, { name: "Checking", type: "asset" });
const archived = a(5, { name: "Old", archivedAt: new Date() });
const obe = a(6, { name: "Opening Balance Equity", type: "equity", isSystem: true });
const savingsWithBuckets = a(7, { name: "Savings", type: "asset", bucketsEnabled: true });
const all = [home, utilities, electric, checking, archived, obe, savingsWithBuckets];

function expectUserError(fn: () => void, pattern: RegExp) {
  expect(fn).toThrow(UserFacingError);
  expect(fn).toThrow(pattern);
}

describe("parseAccountInput", () => {
  it("trims, defaults optional fields, and accepts a valid account", () => {
    const input = parseAccountInput({
      name: "  Groceries ",
      code: "",
      type: "expense",
      subtype: "expense",
      parentAccountId: "",
      description: "",
    });
    expect(input).toEqual({
      name: "Groceries",
      code: null,
      type: "expense",
      subtype: "expense",
      parentAccountId: null,
      description: null,
    });
  });

  it("requires a name", () => {
    expectUserError(
      () => parseAccountInput({ name: " ", type: "expense", subtype: "expense" }),
      /name/i,
    );
  });

  it("rejects a detail type from another account type", () => {
    expectUserError(
      () => parseAccountInput({ name: "X", type: "expense", subtype: "bank" }),
      /doesn't belong/,
    );
  });

  it("rejects unknown types and odd account numbers", () => {
    expectUserError(() => parseAccountInput({ name: "X", type: "cash", subtype: "bank" }), /type/i);
    expectUserError(
      () => parseAccountInput({ name: "X", type: "asset", subtype: "bank", code: "10 10" }),
      /letters, digits/,
    );
  });
});

describe("assertValidParent", () => {
  it("allows a same-type, active parent", () => {
    expect(() => assertValidParent({ type: "expense", parentId: home.id, all })).not.toThrow();
  });

  it("allows top level", () => {
    expect(() => assertValidParent({ type: "expense", parentId: null, all })).not.toThrow();
  });

  it("requires the same type as the parent", () => {
    expectUserError(
      () => assertValidParent({ type: "asset", parentId: home.id, all }),
      /same type as its parent \(Expense\)/,
    );
  });

  it("blocks cycles: an account cannot move under itself or its descendants", () => {
    expectUserError(
      () => assertValidParent({ accountId: home.id, type: "expense", parentId: home.id, all }),
      /own parent/,
    );
    expectUserError(
      () => assertValidParent({ accountId: home.id, type: "expense", parentId: electric.id, all }),
      /its own sub-accounts/,
    );
  });

  it("blocks archived parents, bucket parents and unknown parents", () => {
    expectUserError(
      () => assertValidParent({ type: "expense", parentId: archived.id, all }),
      /archived/,
    );
    expectUserError(
      () => assertValidParent({ type: "asset", parentId: savingsWithBuckets.id, all }),
      /bucket/,
    );
    expectUserError(
      () => assertValidParent({ type: "expense", parentId: uuid(99), all }),
      /doesn't exist/,
    );
  });
});

describe("archive, unarchive, delete and type changes", () => {
  it("refuses to archive system accounts", () => {
    expectUserError(() => assertCanArchive(obe, all), /used by the app/);
  });

  it("requires sub-accounts to be archived first", () => {
    expectUserError(() => assertCanArchive(home, all), /Archive its sub-accounts first: Utilities/);
    expect(() => assertCanArchive(electric, all)).not.toThrow();
  });

  it("requires the parent to be active before restoring", () => {
    const child = a(8, { parentAccountId: archived.id, archivedAt: new Date() });
    expectUserError(() => assertCanUnarchive(child, [...all, child]), /Restore its parent/);
    expect(() => assertCanUnarchive(archived, all)).not.toThrow();
  });

  it("only deletes leaf, non-system accounts without activity", () => {
    expect(() => assertCanDelete(electric, all, false)).not.toThrow();
    expectUserError(() => assertCanDelete(electric, all, true), /only be archived/);
    expectUserError(() => assertCanDelete(home, all, false), /sub-accounts/);
    expectUserError(() => assertCanDelete(obe, all, false), /can't be deleted/);
  });

  it("locks the type of system accounts and of accounts with children", () => {
    expectUserError(() => assertCanChangeType(obe, "asset", all), /System accounts/);
    expectUserError(() => assertCanChangeType(home, "income", all), /sub-accounts/);
    expect(() => assertCanChangeType(electric, "income", all)).not.toThrow();
  });
});
