import { describe, expect, it } from "vitest";
import { checkBalances } from "@/lib/statement-check";

const rows = [
  { line: 1, amountCents: -4500 },
  { line: 2, amountCents: 30000 },
  { line: 3, amountCents: -1250 },
];

describe("checking rows against statement balances", () => {
  it("waits until both balances are entered, and explains a bad one", () => {
    expect(checkBalances("", "100", rows, false)).toEqual({ state: "empty" });
    expect(checkBalances("abc", "100", rows, false)).toMatchObject({
      state: "invalid",
      field: "begin",
    });
  });

  it("a bank account: beginning plus money in, minus money out", () => {
    // 1,000.00 - 45.00 + 300.00 - 12.50 = 1,242.50
    const r = checkBalances("1,000.00", "$1,242.50", rows, false);
    expect(r).toMatchObject({ state: "match", inCents: 30000, outCents: -5750 });
  });

  it("a card: charges raise what you owe and payments lower it", () => {
    // Owed 500.00, charges 57.50, payment 300.00: owe 257.50.
    expect(checkBalances("500", "257.50", rows, true).state).toBe("match");
  });

  it("finds the one row whose sign is wrong", () => {
    // The statement had the 12.50 as money in.
    const r = checkBalances("1000", "1267.50", rows, false);
    expect(r).toMatchObject({ state: "off", differenceCents: 2500, flipLine: 3, flipAll: false });
  });

  it("notices when every sign is the wrong way round", () => {
    const r = checkBalances("1000", "757.50", rows, false);
    expect(r).toMatchObject({ state: "off", flipAll: true });
    expect(checkBalances("500", "742.50", rows, true)).toMatchObject({ flipAll: true });
  });

  it("reports how far off when a row is missing", () => {
    const r = checkBalances("1000", "1200", rows, false);
    expect(r).toMatchObject({
      state: "off",
      differenceCents: -4250,
      flipLine: null,
      flipAll: false,
    });
  });
});
