import { describe, expect, it } from "vitest";
import { describeSync, isSyncEveryHours, syncCron, syncHours } from "@/lib/bank-sync";

describe("bank sync schedule", () => {
  it("divides the day evenly from the chosen hour", () => {
    expect(syncHours(24, 6)).toEqual([6]);
    expect(syncHours(12, 6)).toEqual([6, 18]);
    expect(syncHours(12, 15)).toEqual([3, 15]);
    expect(syncHours(6, 6)).toEqual([0, 6, 12, 18]);
    expect(syncHours(4, 5)).toEqual([1, 5, 9, 13, 17, 21]);
    expect(syncHours(0, 6)).toEqual([]);
  });

  it("makes a cron expression, or none when off", () => {
    expect(syncCron(24, 6, 17)).toBe("17 6 * * *");
    expect(syncCron(6, 7, 42)).toBe("42 1,7,13,19 * * *");
    expect(syncCron(0, 6, 17)).toBeNull();
    expect(syncCron(5, 6, 17)).toBeNull();
  });

  it("only allows the offered choices", () => {
    expect([24, 12, 6, 4, 0].every(isSyncEveryHours)).toBe(true);
    expect([1, 2, 3, 5, 8, "24", null].some(isSyncEveryHours)).toBe(false);
  });

  it("describes the schedule in words", () => {
    expect(describeSync(24, 6)).toBe("every day at 6:00 AM");
    expect(describeSync(12, 6)).toBe("twice a day, at 6:00 AM and 6:00 PM");
    expect(describeSync(6, 0)).toBe("every 6 hours, at 12:00 AM, 6:00 AM, 12:00 PM and 6:00 PM");
    expect(describeSync(0, 6)).toBe("only when someone presses Sync now");
  });
});
