import { describe, expect, it } from "vitest";
import { resolveRange, todayIso } from "@/lib/dates";
import { naturalBalance, naturalToSides, parseDraftLines } from "@/lib/ledger-math";
import { describeAudit } from "@/server/audit/describe";

const l = (accountId: string, debit = "", credit = "", memo = "") => ({
  accountId,
  debit,
  credit,
  memo,
});

describe("parseDraftLines", () => {
  it("totals lines and skips blank rows", () => {
    const r = parseDraftLines([l("a", "1,200.50"), l("b", "", "1200.5"), l("")]);
    expect(r.problems).toEqual([]);
    expect(r.parsed).toHaveLength(2);
    expect(r.debitTotal).toBe(120050);
    expect(r.creditTotal).toBe(120050);
  });

  it("reports each problem with its line", () => {
    const r = parseDraftLines([l("", "5"), l("b", "5", "5"), l("c"), l("d", "abc")]);
    expect(r.problems.map((p) => [p.index, p.field])).toEqual([
      [0, "accountId"],
      [1, "credit"],
      [2, "debit"],
      [3, "debit"],
    ]);
  });

  it("asks for the other column instead of negatives", () => {
    const r = parseDraftLines([l("a", "-5")]);
    expect(r.problems[0]!.message).toMatch(/other column/);
  });
});

describe("natural balances", () => {
  it("shows each type in its normal direction", () => {
    expect(naturalBalance("asset", 1000, 300)).toBe(700);
    expect(naturalBalance("expense", 1000, 300)).toBe(700);
    expect(naturalBalance("liability", 300, 1000)).toBe(700);
    expect(naturalBalance("income", 300, 1000)).toBe(700);
    expect(naturalBalance("equity", 1000, 0)).toBe(-1000);
  });

  it("round-trips natural amounts to debit or credit sides", () => {
    expect(naturalToSides("asset", 500)).toEqual({ debitCents: 500, creditCents: 0 });
    expect(naturalToSides("asset", -500)).toEqual({ debitCents: 0, creditCents: 500 });
    expect(naturalToSides("liability", 500)).toEqual({ debitCents: 0, creditCents: 500 });
    expect(naturalToSides("liability", -500)).toEqual({ debitCents: 500, creditCents: 0 });
    for (const t of ["asset", "liability", "equity", "income", "expense"] as const) {
      const s = naturalToSides(t, 1234);
      expect(naturalBalance(t, s.debitCents, s.creditCents)).toBe(1234);
    }
  });
});

describe("date ranges", () => {
  const today = "2026-11-17";
  it.each([
    ["this-month", "2026-11-01", "2026-11-30"],
    ["last-month", "2026-10-01", "2026-10-31"],
    ["ytd", "2026-01-01", "2026-11-17"],
    ["last-year", "2025-01-01", "2025-12-31"],
  ])("%s", (range, from, to) => {
    expect(resolveRange({ range }, today)).toMatchObject({ preset: range, from, to });
  });

  it("handles January and leap years", () => {
    expect(resolveRange({ range: "last-month" }, "2026-01-15")).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(resolveRange({ range: "this-month" }, "2028-02-10")).toMatchObject({ to: "2028-02-29" });
  });

  it("prefers a valid custom range and ignores junk", () => {
    expect(
      resolveRange({ from: "2026-03-01", to: "2026-03-31", range: "ytd" }, today),
    ).toMatchObject({
      preset: "custom",
      from: "2026-03-01",
    });
    expect(resolveRange({ from: "2026-02-30", range: "nope" }, today, "all")).toMatchObject({
      preset: "all",
    });
  });

  it("computes today in a given time zone", () => {
    const instant = new Date("2026-11-18T03:00:00Z");
    expect(todayIso("UTC", instant)).toBe("2026-11-18");
    expect(todayIso("America/Denver", instant)).toBe("2026-11-17");
  });
});

describe("describeAudit", () => {
  const names = new Map([["p1", "Home"]]);
  it("names renames and moves in plain words", () => {
    const d = describeAudit(
      {
        entityType: "account",
        entityId: "x",
        action: "update",
        beforeData: { name: "Fuel", parentAccountId: null, code: null },
        afterData: { name: "Gas", parentAccountId: "p1", code: null },
      },
      names,
    );
    expect(d.summary).toBe("Renamed account Fuel to Gas");
    expect(d.details).toEqual(["Parent: top level to Home"]);
  });

  it("describes journal edits with the new version", () => {
    const d = describeAudit(
      {
        entityType: "journal_entry",
        entityId: "e",
        action: "update",
        beforeData: { entryNumber: 4, entryDate: "2026-02-01", memo: "A", lines: [1, 2] },
        afterData: {
          entryNumber: 4,
          entryDate: "2026-02-03",
          memo: "A",
          currentVersion: 2,
          lines: [1, 2, 3],
        },
      },
      names,
    );
    expect(d.summary).toBe("Edited JE 4, now version 2");
    expect(d.details).toEqual(["Date: 2026-02-01 to 2026-02-03", "Lines: 2 to 3"]);
    expect(d.link).toEqual({ kind: "entry", id: "e" });
  });
});
