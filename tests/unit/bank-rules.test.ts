import { describe, expect, it } from "vitest";
import {
  type Rule,
  describeConditions,
  evaluateRules,
  ruleActionsSchema,
  ruleConditionsSchema,
} from "@/lib/rules";
import { pairTransfers } from "@/lib/transfer-match";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const C = "00000000-0000-4000-8000-00000000000c";

function rule(id: string, priority: number, conditions: unknown, actions: unknown): Rule {
  return {
    id,
    priority,
    enabled: true,
    conditions: ruleConditionsSchema.parse(conditions),
    actions: ruleActionsSchema.parse(actions),
  };
}

const subject = (description: string, amountCents = -1000, payee: string | null = null) => ({
  accountId: A,
  amountCents,
  description,
  payee,
});

describe("rules engine", () => {
  it("matches text case- and space-insensitively", () => {
    const r = rule("r", 1, { text: { value: "grocery  STORE" } }, { offsetAccountId: B });
    expect(evaluateRules([r], subject("LOCAL Grocery Store #1133")).offsetAccountId).toBe(B);
    expect(evaluateRules([r], subject("Hardware")).offsetAccountId).toBeNull();
  });

  it("supports equals, starts with, regex, and the payee field", () => {
    const eq = rule(
      "eq",
      1,
      { text: { field: "payee", op: "equals", value: "shell" } },
      { memo: "Gas" },
    );
    expect(evaluateRules([eq], subject("x", -1, "Shell")).memo).toBe("Gas");
    expect(evaluateRules([eq], subject("Shell", -1, "Shell Oil")).memo).toBeNull();
    const sw = rule("sw", 1, { text: { op: "starts_with", value: "amzn" } }, { memo: "Amazon" });
    expect(evaluateRules([sw], subject("AMZN Mktp US")).memo).toBe("Amazon");
    const re = rule("re", 1, { text: { op: "regex", value: "^netflix|hulu" } }, { memo: "TV" });
    expect(evaluateRules([re], subject("HULU 877")).memo).toBe("TV");
  });

  it("checks amount ranges against the size of the amount, and direction separately", () => {
    const r = rule(
      "r",
      1,
      { amount: { minCents: 500, maxCents: 1500 }, direction: "outflow" },
      { offsetAccountId: B },
    );
    expect(evaluateRules([r], subject("x", -1000)).offsetAccountId).toBe(B);
    expect(evaluateRules([r], subject("x", 1000)).offsetAccountId).toBeNull();
    expect(evaluateRules([r], subject("x", -2000)).offsetAccountId).toBeNull();
  });

  it("limits a rule to one account", () => {
    const r = rule("r", 1, { accountId: B }, { memo: "m" });
    expect(evaluateRules([r], subject("x")).memo).toBeNull();
  });

  it("takes each action from the first matching rule by priority", () => {
    const specific = rule("s", 1, { text: { value: "costco gas" } }, { offsetAccountId: C });
    const broad = rule(
      "b",
      2,
      { text: { value: "costco" } },
      { offsetAccountId: B, payee: "Costco" },
    );
    const out = evaluateRules([broad, specific], subject("COSTCO GAS #12"));
    expect(out).toMatchObject({ offsetAccountId: C, payee: "Costco", ruleId: "s" });
  });

  it("ignores disabled rules", () => {
    const r = { ...rule("r", 1, { text: { value: "x" } }, { memo: "m" }), enabled: false };
    expect(evaluateRules([r], subject("x")).ruleId).toBeNull();
  });

  it("refuses empty rules, bad patterns and slow patterns", () => {
    expect(ruleConditionsSchema.safeParse({}).success).toBe(false);
    expect(ruleActionsSchema.safeParse({}).success).toBe(false);
    expect(ruleConditionsSchema.safeParse({ text: { op: "regex", value: "(" } }).success).toBe(
      false,
    );
    expect(ruleConditionsSchema.safeParse({ text: { op: "regex", value: "(a+)+$" } }).success).toBe(
      false,
    );
    expect(
      ruleConditionsSchema.safeParse({ amount: { minCents: 500, maxCents: 100 } }).success,
    ).toBe(false);
  });

  it("describes conditions in plain words", () => {
    const c = ruleConditionsSchema.parse({
      text: { field: "payee", op: "equals", value: "Shell" },
      amount: { minCents: 1000, maxCents: 1000 },
      direction: "outflow",
      accountId: A,
    });
    expect(describeConditions(c, () => "Checking")).toBe(
      'payee is exactly "Shell", money out, amount is $10.00, on Checking',
    );
  });
});

const item = (
  id: string,
  accountId: string,
  amountCents: number,
  postedDate: string,
  bookId = "P",
) => ({
  id,
  bookId,
  accountId,
  amountCents,
  postedDate,
});

describe("transfer matching", () => {
  it("pairs equal and opposite amounts on different accounts within a few days", () => {
    const pairs = pairTransfers([
      item("out", A, -50000, "2026-03-01"),
      item("in", B, 50000, "2026-03-03"),
      item("same-account", A, 50000, "2026-03-01"),
      item("too-late", C, 50000, "2026-03-09"),
    ]);
    expect(pairs.get("out")?.id).toBe("in");
    expect(pairs.get("in")?.id).toBe("out");
    expect(pairs.has("same-account")).toBe(false);
    expect(pairs.has("too-late")).toBe(false);
  });

  it("pairs each transaction once, closest dates first", () => {
    const pairs = pairTransfers([
      item("o1", A, -100, "2026-03-01"),
      item("o2", A, -100, "2026-03-05"),
      item("i1", B, 100, "2026-03-05"),
      item("i2", B, 100, "2026-03-02"),
    ]);
    expect(pairs.get("o1")?.id).toBe("i2");
    expect(pairs.get("o2")?.id).toBe("i1");
  });

  it("prefers a partner in the same book when dates tie, and still pairs across books", () => {
    const pairs = pairTransfers([
      item("o", A, -100, "2026-03-01"),
      item("llc", "L1", 100, "2026-03-01", "LLC"),
      item("home", B, 100, "2026-03-01"),
    ]);
    expect(pairs.get("o")?.id).toBe("home");
    const cross = pairTransfers([
      item("o", A, -100, "2026-03-01"),
      item("llc", "L1", 100, "2026-03-02", "LLC"),
    ]);
    expect(cross.get("o")?.bookId).toBe("LLC");
  });

  it("pairs with a side still pending at its bank, in the same book only", () => {
    const pending = (id: string, accountId: string, cents: number, day: string, bookId = "P") => ({
      ...item(id, accountId, cents, day, bookId),
      pending: true,
    });
    // A card payment: posted on checking, still pending on the card.
    const pairs = pairTransfers([
      item("checking", A, -12816, "2026-11-20"),
      pending("card", B, 12816, "2026-11-20"),
    ]);
    expect(pairs.get("checking")?.id).toBe("card");
    // A partner that has cleared wins a tie over a pending one.
    const both = pairTransfers([
      item("checking", A, -100, "2026-11-20"),
      pending("card-pending", B, 100, "2026-11-20"),
      item("card-posted", C, 100, "2026-11-20"),
    ]);
    expect(both.get("checking")?.id).toBe("card-posted");
    // Two pending sides can't be approved, and a pending side in another book isn't offered.
    expect(
      pairTransfers([pending("o", A, -100, "2026-11-20"), pending("i", B, 100, "2026-11-20")]).size,
    ).toBe(0);
    expect(
      pairTransfers([
        item("o", A, -100, "2026-11-20"),
        pending("llc", "L1", 100, "2026-11-20", "LLC"),
      ]).size,
    ).toBe(0);
  });
});

describe("rule text from a transaction", () => {
  it("drops store numbers, dates and reference digits", async () => {
    const { suggestRuleText } = await import("@/lib/rules");
    expect(suggestRuleText("FRESH MARKET #204 03/11")).toBe("FRESH MARKET");
    expect(suggestRuleText("SHELL OIL 57412345")).toBe("SHELL OIL");
    expect(suggestRuleText("NETFLIX.COM")).toBe("NETFLIX.COM");
    expect(suggestRuleText("7-ELEVEN 1234")).toBe("7-ELEVEN");
    expect(suggestRuleText("123")).toBe("123");
  });
});
