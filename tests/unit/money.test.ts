import { describe, expect, it } from "vitest";
import { MoneyError, addCents, assertCents, formatCents, parseCents } from "@/lib/money";

describe("parseCents", () => {
  it.each([
    ["0", 0],
    ["12", 1200],
    ["12.3", 1230],
    ["12.34", 1234],
    [".5", 50],
    ["1,234.56", 123456],
    ["$7.50", 750],
    ["-12.34", -1234],
    ["(45.10)", -4510],
    ["  89.01  ", 8901],
    ["-0", 0],
  ])("parses %s as %i cents", (input, cents) => {
    expect(parseCents(input)).toBe(cents);
  });

  it.each(["", "abc", "1.234", "12.3.4", "1e5", "--5", "$", "(-)"])("rejects %j", (input) => {
    expect(() => parseCents(input)).toThrow(MoneyError);
  });

  it("refuses amounts beyond exact integer range instead of rounding", () => {
    expect(() => parseCents("999999999999999999.99")).toThrow(MoneyError);
  });
});

describe("formatCents", () => {
  it("formats with grouping and two decimals", () => {
    expect(formatCents(123456)).toBe("$1,234.56");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(0)).toBe("$0.00");
  });

  it("shows negatives with a minus sign or parentheses", () => {
    expect(formatCents(-1234)).toBe("-$12.34");
    expect(formatCents(-1234, { negativeStyle: "parens" })).toBe("($12.34)");
  });

  it("can omit the currency symbol", () => {
    expect(formatCents(-123456, { showSymbol: false })).toBe("-1,234.56");
  });

  it("is exact for large values", () => {
    expect(formatCents(9_007_199_254_740_991)).toBe("$90,071,992,547,409.91");
  });

  it("round-trips through parseCents", () => {
    for (const c of [0, 1, 99, 100, 123456789, -42, -100000]) {
      expect(parseCents(formatCents(c, { negativeStyle: "parens" }))).toBe(c);
    }
  });
});

describe("integer guards", () => {
  it("rejects fractional cents and unsafe integers", () => {
    expect(() => assertCents(1.5)).toThrow(MoneyError);
    expect(() => assertCents(Number.MAX_SAFE_INTEGER + 1)).toThrow(MoneyError);
    expect(() => assertCents(Number.NaN)).toThrow(MoneyError);
  });

  it("adds exactly and refuses overflow", () => {
    expect(addCents(10, 20, -5)).toBe(25);
    expect(addCents()).toBe(0);
    expect(() => addCents(Number.MAX_SAFE_INTEGER, 1)).toThrow(MoneyError);
  });
});
