import { describe, expect, it } from "vitest";
import { checkBalances } from "@/lib/statement-check";
import { readPdfStatement, toLines } from "@/server/bank/pdf-service";
import { type PdfText, makePdf } from "../make-pdf";

// Made-up statements in the layouts banks commonly use. Columns sit at fixed x
// positions; amounts are right-aligned the way statements print them.
const TODAY = "2026-11-19";

/** A row of cells; amounts are placed so they end at the given right edge. */
type Cell = [x: number, text: string, align?: "left" | "right"];

function row(y: number, cells: Cell[]): PdfText[] {
  return cells.map(([x, text, align]) => ({
    // Helvetica 9pt digits are 5pt wide; close enough to right-align numbers.
    x: align === "right" ? x - text.length * 5 : x,
    y,
    text,
  }));
}

const read = (pages: PdfText[][], kind: "asset" | "liability" = "asset") =>
  readPdfStatement(new Uint8Array(makePdf(pages)), kind, TODAY);

const simple = (r: { postedDate: string; amountCents: number; description: string }) => [
  r.postedDate,
  r.amountCents,
  r.description,
];

describe("reading statement PDFs", () => {
  it("checking account with sections, a wrapped description, and totals left out", async () => {
    const result = await read([
      [
        ...row(740, [[50, "Example Bank"]]),
        ...row(725, [[50, "January 1, 2026 through January 31, 2026"]]),
        ...row(690, [[50, "DEPOSITS AND ADDITIONS"]]),
        ...row(675, [
          [50, "DATE"],
          [100, "DESCRIPTION"],
          [540, "AMOUNT", "right"],
        ]),
        ...row(660, [
          [50, "01/02"],
          [100, "Payroll Deposit Acme Corp"],
          [540, "$2,500.00", "right"],
        ]),
        ...row(649, [[100, "PPD ID: 1234567890"]]),
        ...row(634, [
          [50, "Total Deposits and Additions"],
          [540, "$2,500.00", "right"],
        ]),
        ...row(600, [[50, "ELECTRONIC WITHDRAWALS"]]),
        ...row(585, [
          [50, "DATE"],
          [100, "DESCRIPTION"],
          [540, "AMOUNT", "right"],
        ]),
        ...row(570, [
          [50, "01/05"],
          [100, "Card Purchase Corner Grocery"],
          [540, "45.10", "right"],
        ]),
        ...row(555, [
          [50, "01/31"],
          [100, "Online Transfer To Savings"],
          [540, "200.00", "right"],
        ]),
      ],
    ]);
    expect(result.periodEnd).toBe("2026-01-31");
    expect(result.rows.map(simple)).toEqual([
      ["2026-01-02", 250000, "Payroll Deposit Acme Corp PPD ID: 1234567890"],
      ["2026-01-05", -4510, "Card Purchase Corner Grocery"],
      ["2026-01-31", -20000, "Online Transfer To Savings"],
    ]);
    expect(result.rows.every((r) => !r.signGuessed)).toBe(true);
  });

  it("one signed amount column with a running balance", async () => {
    const result = await read([
      [
        ...row(740, [[50, "Statement period 03/01/2026 - 03/31/2026"]]),
        ...row(700, [
          [50, "Date"],
          [110, "Description"],
          [450, "Amount", "right"],
          [540, "Balance", "right"],
        ]),
        ...row(685, [
          [50, "03/01"],
          [110, "Beginning Balance"],
          [540, "1,000.00", "right"],
        ]),
        ...row(670, [
          [50, "03/03"],
          [110, "Coffee Shop"],
          [450, "-4.50", "right"],
          [540, "995.50", "right"],
        ]),
        ...row(655, [
          [50, "03/04"],
          [110, "Refund From Store"],
          [450, "20.00", "right"],
          [540, "1,015.50", "right"],
        ]),
        ...row(640, [
          [50, "03/31"],
          [110, "Ending Balance"],
          [540, "1,015.50", "right"],
        ]),
      ],
    ]);
    expect(result.rows.map(simple)).toEqual([
      ["2026-03-03", -450, "Coffee Shop"],
      ["2026-03-04", 2000, "Refund From Store"],
    ]);
    expect(result).toMatchObject({ openingCents: 100000, closingCents: 101550 });
  });

  it("separate withdrawal and deposit columns", async () => {
    const result = await read([
      [
        ...row(740, [[50, "Account activity 04/01/2026 to 04/30/2026"]]),
        ...row(700, [
          [50, "Date"],
          [110, "Details"],
          [380, "Withdrawals", "right"],
          [460, "Deposits", "right"],
          [540, "Balance", "right"],
        ]),
        ...row(685, [
          [50, "04/02"],
          [110, "Electric Company"],
          [380, "88.20", "right"],
          [540, "911.80", "right"],
        ]),
        ...row(670, [
          [50, "04/15"],
          [110, "Paycheck"],
          [460, "1,200.00", "right"],
          [540, "2,111.80", "right"],
        ]),
      ],
    ]);
    expect(result.rows.map(simple)).toEqual([
      ["2026-04-02", -8820, "Electric Company"],
      ["2026-04-15", 120000, "Paycheck"],
    ]);
  });

  it("credit card: charges are money out, payments and CR credits are money in, across New Year", async () => {
    const result = await read(
      [
        [
          ...row(740, [[50, "Opening/Closing Date 12/05/25 - 01/04/26"]]),
          ...row(725, [
            [50, "Previous Balance"],
            [300, "$900.00", "right"],
          ]),
          ...row(712, [
            [50, "New Balance"],
            [300, "$433.00", "right"],
          ]),
          ...row(700, [
            [50, "Trans Date"],
            [100, "Post Date"],
            [150, "Description"],
            [540, "Amount", "right"],
          ]),
          ...row(685, [
            [50, "12/27"],
            [100, "12/28"],
            [150, "HARDWARE STORE #12"],
            [540, "45.00", "right"],
          ]),
          ...row(670, [
            [50, "01/02"],
            [100, "01/02"],
            [150, "PAYMENT THANK YOU"],
            [540, "-500.00", "right"],
          ]),
        ],
        [
          ...row(740, [
            [50, "01/03"],
            [100, "01/03"],
            [150, "RETURNED ITEM"],
            [540, "12.00 CR", "right"],
          ]),
        ],
      ],
      "liability",
    );
    expect(result.rows.map(simple)).toEqual([
      ["2025-12-28", -4500, "HARDWARE STORE #12"],
      ["2026-01-02", 50000, "PAYMENT THANK YOU"],
      ["2026-01-03", 1200, "RETURNED ITEM"],
    ]);
    expect(result.rows[2]!.page).toBe(2);
    // What is owed: 900.00 + 45.00 charged - 500.00 paid - 12.00 returned.
    expect(result).toMatchObject({ openingCents: 90000, closingCents: 43300 });
    expect(checkBalances("900", "433", result.rows, true).state).toBe("match");
  });

  it("day-first dates, and a note when nothing says which way money moved", async () => {
    const result = await read([
      [
        ...row(700, [
          [50, "31/01/2026"],
          [130, "Bakery"],
          [540, "3.20", "right"],
        ]),
        ...row(685, [
          [50, "02/02/2026"],
          [130, "Bookshop"],
          [540, "15.00", "right"],
        ]),
      ],
    ]);
    expect(result.rows.map((r) => r.postedDate)).toEqual(["2026-01-31", "2026-02-02"]);
    expect(result.rows.every((r) => r.signGuessed)).toBe(true);
    expect(result.notes.join(" ")).toMatch(/check the marked rows/);
  });

  it("says when a file isn't a PDF, or has no text", async () => {
    await expect(
      readPdfStatement(new TextEncoder().encode("Date,Amount\n"), "asset", TODAY),
    ).rejects.toThrow(/isn't a PDF/);
    await expect(read([[]])).rejects.toThrow(/probably a scan/);
    await expect(read([row(700, [[50, "Hello there"]])])).rejects.toThrow(/No transactions/);
  });
});

describe("grouping PDF text into lines and cells", () => {
  it("joins close words and splits at wide gaps", () => {
    const item = (str: string, x: number, y: number, width: number) => ({
      str,
      transform: [9, 0, 0, 9, x, y],
      width,
      height: 9,
    });
    const lines = toLines(1, [
      item("Coffee", 100, 700, 28),
      item("01/05", 50, 700.5, 22),
      item("Shop", 130.5, 700, 20),
      item(" ", 150, 700, 3),
      item("4.50", 500, 699.8, 18),
      item("Next line", 50, 688, 40),
    ]);
    expect(lines.map((l) => l.cells.map((c) => c.text))).toEqual([
      ["01/05", "Coffee Shop", "4.50"],
      ["Next line"],
    ]);
  });
});
