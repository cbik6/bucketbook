import { describe, expect, it } from "vitest";
import {
  type AllocationRule,
  allocateDeposit,
  allocateMonthly,
  goalProgress,
  monthsUntil,
} from "@/lib/buckets";

const rule = (over: Partial<AllocationRule>): AllocationRule => ({
  id: "r",
  bucketAccountId: "b",
  kind: "percent",
  amountCents: null,
  percentBp: null,
  minDepositCents: null,
  priority: 1,
  enabled: true,
  ...over,
});

describe("deposit allocation", () => {
  it("takes percentages of the whole deposit, rounded down, in priority order", () => {
    const out = allocateDeposit(100_001, [
      rule({ id: "b", bucketAccountId: "vacation", percentBp: 1000, priority: 2 }),
      rule({ id: "a", bucketAccountId: "car", kind: "fixed", amountCents: 20_000, priority: 1 }),
    ]);
    expect(out).toEqual([
      { ruleId: "a", bucketAccountId: "car", cents: 20_000 },
      { ruleId: "b", bucketAccountId: "vacation", cents: 10_000 },
    ]);
  });

  it("never allocates more than the deposit, and leaves the rest in Unassigned", () => {
    const out = allocateDeposit(15_000, [
      rule({ id: "a", kind: "fixed", amountCents: 10_000, priority: 1 }),
      rule({ id: "b", kind: "fixed", amountCents: 10_000, priority: 2 }),
      rule({ id: "c", kind: "percent", percentBp: 5000, priority: 3 }),
    ]);
    expect(out.map((a) => a.cents)).toEqual([10_000, 5_000]);
  });

  it("skips disabled rules, monthly rules, and deposits under the minimum", () => {
    expect(
      allocateDeposit(5_000, [
        rule({ enabled: false, percentBp: 1000 }),
        rule({ kind: "monthly", amountCents: 100 }),
        rule({ percentBp: 1000, minDepositCents: 10_000 }),
      ]),
    ).toEqual([]);
    expect(allocateDeposit(-500, [rule({ percentBp: 1000 })])).toEqual([]);
  });
});

describe("monthly allocation", () => {
  it("fills rules in order from what Unassigned holds, partly filling the last", () => {
    const out = allocateMonthly(25_000, [
      rule({ id: "a", kind: "monthly", amountCents: 20_000, priority: 1 }),
      rule({ id: "b", kind: "monthly", amountCents: 10_000, priority: 2 }),
      rule({ id: "c", kind: "monthly", amountCents: 10_000, priority: 3 }),
    ]);
    expect(out.map((a) => [a.ruleId, a.cents])).toEqual([
      ["a", 20_000],
      ["b", 5_000],
    ]);
    expect(allocateMonthly(-100, [rule({ kind: "monthly", amountCents: 1 })])).toEqual([]);
  });
});

describe("goals", () => {
  it("counts months to the goal date, counting a partial month", () => {
    expect(monthsUntil("2026-11-18", "2027-05-18")).toBe(6);
    expect(monthsUntil("2026-11-18", "2027-05-20")).toBe(7);
    expect(monthsUntil("2026-11-18", "2026-11-01")).toBe(0);
  });

  it("suggests a monthly amount, rounded up so the goal is reached on time", () => {
    const g = goalProgress(100_000, 500_000, "2027-05-18", "2026-11-18");
    expect(g).toMatchObject({ remainingCents: 400_000, reached: false, overdue: false });
    expect(g.monthlyCents).toBe(66_667);
    expect(g.fraction).toBeCloseTo(0.2);
  });

  it("reports reached, overdue, and no-date goals", () => {
    expect(goalProgress(600_000, 500_000, "2027-01-01", "2026-11-18")).toMatchObject({
      reached: true,
      fraction: 1,
      monthlyCents: null,
    });
    expect(goalProgress(100, 500, "2026-10-01", "2026-11-18")).toMatchObject({
      overdue: true,
      monthlyCents: 400,
    });
    expect(goalProgress(100, 500, null, "2026-11-18").monthlyCents).toBeNull();
  });
});
