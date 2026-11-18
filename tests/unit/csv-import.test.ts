import { describe, expect, it } from "vitest";
import {
  applyMapping,
  csvFingerprints,
  csvMappingSchema,
  guessDateFormat,
  guessMapping,
  parseCsv,
  parseCsvAmount,
  parseCsvDate,
} from "@/lib/csv-import";

describe("CSV parsing", () => {
  it("handles quotes, embedded commas and newlines, CRLF, and a BOM", () => {
    const text =
      '\uFEFFDate,Description,Amount\r\n2026-01-02,"Shop, Inc.",-5.00\r\n2026-01-03,"Line\nbreak ""quoted""",10\r\n\r\n';
    expect(parseCsv(text)).toEqual([
      ["Date", "Description", "Amount"],
      ["2026-01-02", "Shop, Inc.", "-5.00"],
      ["2026-01-03", 'Line\nbreak "quoted"', "10"],
    ]);
  });

  it("detects semicolon and tab delimiters", () => {
    expect(parseCsv("a;b;c\n1;2;3")[1]).toEqual(["1", "2", "3"]);
    expect(parseCsv("a\tb\n1\t2")[1]).toEqual(["1", "2"]);
  });

  it("reads dates in each format and guesses the format", () => {
    expect(parseCsvDate("1/5/2026", "MM/DD/YYYY")).toBe("2026-01-05");
    expect(parseCsvDate("05/01/26", "DD/MM/YYYY")).toBe("2026-01-05");
    expect(parseCsvDate("2026-02-30", "YYYY-MM-DD")).toBeNull();
    expect(parseCsvDate("2026-01-05T00:00:00", "YYYY-MM-DD")).toBe("2026-01-05");
    expect(guessDateFormat(["01/31/2026", "02/01/2026"])).toBe("MM/DD/YYYY");
    expect(guessDateFormat(["31/01/2026"])).toBe("DD/MM/YYYY");
  });

  it("reads bank amount styles", () => {
    expect(parseCsvAmount("1,234.56")).toBe(123456);
    expect(parseCsvAmount("(45.10)")).toBe(-4510);
    expect(parseCsvAmount("-$7.50")).toBe(-750);
    expect(parseCsvAmount("+12")).toBe(1200);
    expect(parseCsvAmount("12.00 DR")).toBe(-1200);
    expect(parseCsvAmount("12.00 CR")).toBe(1200);
    expect(parseCsvAmount("")).toBeNull();
    expect(parseCsvAmount("abc")).toBeNull();
  });

  it("maps signed and split amount columns and flips card exports", () => {
    const rows = parseCsv(
      "Date,Desc,Out,In\n01/02/2026,Coffee,4.50,\n01/03/2026,Pay,,100.00\n01/04/2026,,1,\nbad,X,1,",
    );
    const mapping = csvMappingSchema.parse({
      dateColumn: 0,
      dateFormat: "MM/DD/YYYY",
      descriptionColumn: 1,
      amountMode: "split",
      outflowColumn: 2,
      inflowColumn: 3,
    });
    const out = applyMapping(rows, mapping);
    expect(out.rows.map((r) => [r.postedDate, r.amountCents, r.description])).toEqual([
      ["2026-01-02", -450, "Coffee"],
      ["2026-01-03", 10000, "Pay"],
    ]);
    expect(out.problems.map((p) => p.line)).toEqual([4, 5]);

    const card = applyMapping(
      parseCsv("Date,Desc,Amount\n2026-01-02,Store,25.00"),
      csvMappingSchema.parse({
        dateColumn: 0,
        dateFormat: "YYYY-MM-DD",
        descriptionColumn: 1,
        amountMode: "signed",
        amountColumn: 2,
        flipSign: true,
      }),
    );
    expect(card.rows[0]!.amountCents).toBe(-2500);
  });

  it("fingerprints identical rows on the same day separately and stably", () => {
    const r = { postedDate: "2026-01-02", amountCents: -500, description: "Coffee" };
    const fp = csvFingerprints([r, { ...r, description: " coffee " }, { ...r, amountCents: -600 }]);
    expect(fp[0]).not.toBe(fp[1]);
    expect(fp[1]).toMatch(/\|2$/);
    expect(csvFingerprints([r])[0]).toBe(fp[0]);
  });

  it("guesses columns from common headers", () => {
    const header = ["Posting Date", "Description", "Amount", "Type"];
    const g = guessMapping(header, [["01/02/2026", "X", "-1", "DEBIT"]]);
    expect(g).toMatchObject({
      dateColumn: 0,
      dateFormat: "MM/DD/YYYY",
      descriptionColumn: 1,
      amountMode: "signed",
      amountColumn: 2,
    });
    const split = guessMapping(["Date", "Details", "Withdrawal", "Deposit"], [["2026-01-02"]]);
    expect(split).toMatchObject({ amountMode: "split", outflowColumn: 2, inflowColumn: 3 });
  });
});
