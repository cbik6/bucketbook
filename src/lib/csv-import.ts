import { z } from "zod";
import { isIsoDate } from "./dates";
import { parseCents } from "./money";

/**
 * CSV import: parse the file, map its columns once per account (saved as a
 * preset), and turn rows into bank transactions. Parsing happens in the
 * browser for the preview; the server re-checks every row it receives.
 */

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5000;

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const src = text.replace(/^\uFEFF/, "");
  const delim = delimiter ?? detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") inQuotes = true;
    else if (ch === delim) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 1 ? counts[0]![0] : ",";
}

export const DATE_FORMATS = ["YYYY-MM-DD", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const csvMappingSchema = z
  .object({
    hasHeader: z.boolean().default(true),
    dateColumn: z.number().int().nonnegative(),
    dateFormat: z.enum(DATE_FORMATS),
    descriptionColumn: z.number().int().nonnegative(),
    payeeColumn: z.number().int().nonnegative().nullish(),
    memoColumn: z.number().int().nonnegative().nullish(),
    /** "signed": one amount column. "split": separate money-out and money-in columns. */
    amountMode: z.enum(["signed", "split"]),
    amountColumn: z.number().int().nonnegative().nullish(),
    outflowColumn: z.number().int().nonnegative().nullish(),
    inflowColumn: z.number().int().nonnegative().nullish(),
    /** For files where purchases are positive (common for credit cards). */
    flipSign: z.boolean().default(false),
  })
  .refine(
    (m) =>
      m.amountMode === "signed"
        ? m.amountColumn != null
        : m.outflowColumn != null && m.inflowColumn != null,
    "Pick the amount columns.",
  );

export type CsvMapping = z.infer<typeof csvMappingSchema>;

/** Reads a date in the given format, accepting 1 or 2 digit days and months and 2 digit years. */
export function parseCsvDate(raw: string, format: DateFormat): string | null {
  const text = raw.trim().split(/[ T]/)[0] ?? "";
  const parts = text.split(/[-/.]/);
  if (parts.length !== 3) return null;
  let y: string, m: string, d: string;
  if (format === "YYYY-MM-DD" || format === "YYYY/MM/DD")
    [y, m, d] = parts as [string, string, string];
  else if (format === "MM/DD/YYYY") [m, d, y] = parts as [string, string, string];
  else [d, m, y] = parts as [string, string, string];
  if (!/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d) || !/^(\d{2}|\d{4})$/.test(y)) return null;
  if (y.length === 2) y = `20${y}`;
  const iso = `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  return isIsoDate(iso) ? iso : null;
}

/** Guesses the date format from sample values: the first format that reads all of them. */
export function guessDateFormat(samples: string[]): DateFormat | null {
  const values = samples.map((s) => s.trim()).filter(Boolean);
  if (values.length === 0) return null;
  for (const f of DATE_FORMATS) {
    if (values.every((v) => parseCsvDate(v, f) !== null)) return f;
  }
  return null;
}

/** Bank amounts: "1,234.56", "-12.00", "(45.10)", "$7.50", "12.00 CR". */
export function parseCsvAmount(raw: string): number | null {
  let text = raw.trim().replace(/\s+/g, "");
  if (text === "") return null;
  let negative = false;
  if (/^-?\$?[\d,.]+(CR|DR)$/i.test(text)) {
    negative = /DR$/i.test(text);
    text = text.slice(0, -2);
  }
  try {
    const cents = parseCents(text.replace(/^(-?)\$/, "$1").replace(/^\+/, ""));
    return negative ? -Math.abs(cents) : cents;
  } catch {
    return null;
  }
}

export type CsvRow = {
  /** 1-based line in the file, for messages. */
  line: number;
  postedDate: string;
  amountCents: number;
  description: string;
  payee: string | null;
  memo: string | null;
};

export type CsvRowProblem = { line: number; message: string };

export function applyMapping(
  rows: string[][],
  mapping: CsvMapping,
): { rows: CsvRow[]; problems: CsvRowProblem[] } {
  const out: CsvRow[] = [];
  const problems: CsvRowProblem[] = [];
  const start = mapping.hasHeader ? 1 : 0;
  const cell = (r: string[], i: number | null | undefined) =>
    i == null ? "" : (r[i] ?? "").replace(/\s+/g, " ").trim();
  for (let i = start; i < rows.length; i++) {
    const r = rows[i]!;
    const line = i + 1;
    const postedDate = parseCsvDate(cell(r, mapping.dateColumn), mapping.dateFormat);
    if (!postedDate) {
      problems.push({ line, message: `Unreadable date "${cell(r, mapping.dateColumn)}"` });
      continue;
    }
    let amount: number | null;
    if (mapping.amountMode === "signed") {
      amount = parseCsvAmount(cell(r, mapping.amountColumn));
    } else {
      const out_ = cell(r, mapping.outflowColumn);
      const in_ = cell(r, mapping.inflowColumn);
      const o = out_ ? parseCsvAmount(out_) : 0;
      const n = in_ ? parseCsvAmount(in_) : 0;
      amount = o === null || n === null ? null : Math.abs(n) - Math.abs(o);
    }
    if (amount === null) {
      problems.push({ line, message: "Unreadable amount" });
      continue;
    }
    if (mapping.flipSign) amount = -amount;
    if (amount === 0) {
      problems.push({ line, message: "Amount is zero" });
      continue;
    }
    const description = cell(r, mapping.descriptionColumn) || cell(r, mapping.payeeColumn);
    if (!description) {
      problems.push({ line, message: "No description" });
      continue;
    }
    out.push({
      line,
      postedDate,
      amountCents: amount,
      description: description.slice(0, 500),
      payee: cell(r, mapping.payeeColumn).slice(0, 200) || null,
      memo: cell(r, mapping.memoColumn).slice(0, 500) || null,
    });
  }
  return { rows: out, problems };
}

/**
 * A stable fingerprint for a CSV row, so importing the same file twice skips
 * what is already there. Identical rows on the same day (two $5 coffees) are
 * told apart by their position among identical rows.
 */
/** "csv:" or "pdf:" fingerprints, so a CSV and a PDF of the same month never collide. */
export function csvFingerprints(
  rows: Pick<CsvRow, "postedDate" | "amountCents" | "description">[],
  kind: "csv" | "pdf" = "csv",
) {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = `${r.postedDate}|${r.amountCents}|${r.description.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${kind}:${base}|${n}`;
  });
}

/** Best guesses for a new file's columns from its header names. */
export function guessMapping(header: string[], sample: string[][]): Partial<CsvMapping> {
  const find = (...patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = header.findIndex((h) => p.test(h.trim()));
      if (i >= 0) return i;
    }
    return null;
  };
  const dateColumn = find(/^(posted|posting|transaction)?\s*date$/i, /date/i);
  const description = find(/^description$/i, /description|details|narrative|name/i);
  const payee = find(/payee|merchant/i);
  const memo = find(/memo|notes?/i);
  const amount = find(/^amount$/i, /amount/i);
  const outflow = find(/debit|withdrawal|money out|outflow|spent/i);
  const inflow = find(/credit|deposit|money in|inflow|received/i);
  const split = amount === null && outflow !== null && inflow !== null;
  const dateFormat =
    dateColumn !== null ? guessDateFormat(sample.map((r) => r[dateColumn] ?? "")) : null;
  return {
    hasHeader: true,
    dateColumn: dateColumn ?? undefined,
    dateFormat: dateFormat ?? undefined,
    descriptionColumn: description ?? undefined,
    payeeColumn: payee !== description ? payee : null,
    memoColumn: memo,
    amountMode: split ? "split" : "signed",
    amountColumn: split ? null : amount,
    outflowColumn: split ? outflow : null,
    inflowColumn: split ? inflow : null,
    flipSign: false,
  };
}
