import { describe, expect, it } from "vitest";
import {
  amortize,
  formatRate,
  levelPayment,
  monthlyInterest,
  parseRate,
  splitPayment,
} from "@/lib/loans";

// Reference values come from the standard amortization formula and a
// month-by-month schedule computed independently with decimal arithmetic.
describe("loan math", () => {
  it("parses and formats rates exactly", () => {
    expect(parseRate("6.5")).toBe(65_000);
    expect(parseRate("6.125%")).toBe(61_250);
    expect(parseRate("0")).toBe(0);
    expect(parseRate("101")).toBeNull();
    expect(parseRate("6.12345")).toBeNull();
    expect(formatRate(61_250)).toBe("6.125%");
    expect(formatRate(70_000)).toBe("7%");
  });

  it("computes the level payment like a standard calculator", () => {
    expect(levelPayment(20_000_000, 65_000, 360)).toBe(126_414);
    expect(levelPayment(2_500_000, 49_000, 60)).toBe(47_064);
    expect(levelPayment(1_000_000, 0, 12)).toBe(83_334);
  });

  it("rounds a month of interest half up to the cent", () => {
    expect(monthlyInterest(20_000_000, 65_000)).toBe(108_333);
    expect(monthlyInterest(0, 65_000)).toBe(0);
    // 1,200,000 cents at 1% a year is exactly 1,000 cents; at 0.5% it is 500.
    expect(monthlyInterest(1_200_000, 10_000)).toBe(1_000);
    expect(monthlyInterest(1_200_000, 5_000)).toBe(500);
  });

  it("builds a 30-year schedule that matches the reference and ends at zero", () => {
    const rows = amortize({
      principalCents: 20_000_000,
      rateMicro: 65_000,
      months: 360,
      paymentCents: 126_414,
      firstPaymentDate: "2026-01-31",
    });
    expect(rows).toHaveLength(360);
    expect(rows[0]).toMatchObject({
      interestCents: 108_333,
      principalCents: 18_081,
      balanceCents: 19_981_919,
      date: "2026-01-31",
    });
    expect(rows[1]!.date).toBe("2026-02-28");
    expect(rows.at(-1)!.balanceCents).toBe(0);
    expect(rows.reduce((n, r) => n + r.principalCents, 0)).toBe(20_000_000);
    expect(rows.reduce((n, r) => n + r.interestCents, 0)).toBe(25_508_582);
  });

  it("refuses a payment that never pays the loan off", () => {
    expect(() =>
      amortize({
        principalCents: 1_000_000,
        rateMicro: 120_000,
        months: 12,
        paymentCents: 5_000,
        firstPaymentDate: "2026-01-01",
      }),
    ).toThrow(/doesn't cover the interest/);
  });

  it("splits an actual payment into interest and principal", () => {
    expect(splitPayment(126_414, 20_000_000, 65_000)).toEqual({
      interestCents: 108_333,
      principalCents: 18_081,
    });
    expect(splitPayment(50_000, 20_000_000, 65_000)).toEqual({
      interestCents: 50_000,
      principalCents: 0,
    });
  });
});
