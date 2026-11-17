import { describe, expect, it } from "vitest";
import {
  ACCOUNT_TYPES,
  type AccountType,
  BOOK_TEMPLATES,
  SYSTEM_ROLES,
  isSubtypeOf,
} from "@/lib/account-types";
import {
  CHART_TEMPLATES,
  type TemplateAccount,
  templateSummaries,
} from "@/server/accounts/templates";

function walk(
  list: TemplateAccount[],
  type: AccountType,
  visit: (a: TemplateAccount, type: AccountType, siblings: TemplateAccount[]) => void,
) {
  for (const a of list) {
    visit(a, type, list);
    walk(a.children ?? [], type, visit);
  }
}

/** En dash and em dash, written as code points so no literal dash appears in source. */
const DASHES = [String.fromCharCode(0x2013), String.fromCharCode(0x2014)];

describe.each(BOOK_TEMPLATES)("%s template", (id) => {
  const template = CHART_TEMPLATES[id];
  const all: { a: TemplateAccount; type: AccountType; siblings: TemplateAccount[] }[] = [];
  for (const type of ACCOUNT_TYPES) {
    walk(template.accounts[type], type, (a, t, siblings) => all.push({ a, type: t, siblings }));
  }

  it("is registered under its own id", () => {
    expect(template.id).toBe(id);
  });

  it("uses only detail types that belong to each account's type", () => {
    for (const { a, type } of all) expect(isSubtypeOf(type, a.subtype), a.name).toBe(true);
  });

  it("has exactly one account for each system role, at the top level of Equity", () => {
    for (const role of SYSTEM_ROLES) {
      const matches = all.filter(({ a }) => a.systemRole === role);
      expect(matches, role).toHaveLength(1);
      expect(matches[0]!.type).toBe("equity");
      expect(template.accounts.equity).toContain(matches[0]!.a);
    }
  });

  it("has unique sibling names (case-insensitive), as the database requires", () => {
    for (const { siblings } of all) {
      const names = siblings.map((s) => s.name.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("has unique account numbers made of digits", () => {
    const codes = all.map(({ a }) => a.code).filter((c): c is string => Boolean(c));
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^\d{4}$/);
  });

  it("uses no em or en dashes in names or descriptions", () => {
    const text = [
      template.label,
      template.description,
      ...all.map(({ a }) => `${a.name} ${a.description ?? ""}`),
    ];
    for (const t of text) expect([...t].some((ch) => DASHES.includes(ch))).toBe(false);
  });
});

describe("templateSummaries", () => {
  it("counts every account, including nested ones", () => {
    const byId = Object.fromEntries(templateSummaries().map((s) => [s.id, s]));
    expect(byId.blank!.accountCount).toBe(2);
    expect(byId.household!.accountCount).toBeGreaterThan(20);
    expect(byId.small_business!.accountCount).toBeGreaterThan(20);
  });
});
