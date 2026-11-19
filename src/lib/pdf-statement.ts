import { isIsoDate } from "./dates";

/**
 * Reads transactions out of a bank or credit card statement PDF, given its
 * text as positioned lines (see server/bank/pdf-service.ts). Statements have
 * no standard layout, so this looks for what most of them share: a line that
 * starts with a date, has a description, and ends with an amount. The result
 * is always shown to the person as a preview before anything is imported.
 */

export const MAX_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_PDF_PAGES = 60;

/** A run of text on one line, with its left and right edges in PDF points. */
export type PdfCell = { x: number; right: number; text: string };
export type PdfLine = { page: number; y: number; height: number; cells: PdfCell[] };

export type StatementRow = {
  /** 1-based position in the statement, for keys and messages. */
  line: number;
  page: number;
  postedDate: string;
  amountCents: number;
  description: string;
  /** True when nothing on the statement said which way the money moved. */
  signGuessed: boolean;
};

export type StatementResult = {
  rows: StatementRow[];
  periodStart: string | null;
  periodEnd: string | null;
  notes: string[];
};

export type AccountKind = "asset" | "liability";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (word: string) => {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return -1;
  const i = MONTHS.indexOf(w.slice(0, 3));
  // "Sept", "January": a full or common short name only, not any word starting "mar".
  if (i < 0) return -1;
  const full = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ][i]!;
  return full.startsWith(w) || w === "sept" ? i : -1;
};

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (y: number, m: number, d: number) => {
  const v = `${y}-${pad(m)}-${pad(d)}`;
  return isIsoDate(v) ? v : null;
};
const dayNum = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
const fullYear = (y: number) => (y < 100 ? 2000 + y : y);

/* ---------- Tokens ---------- */

type Token = { text: string; right: number | null };

function tokenize(line: PdfLine): Token[] {
  const out: Token[] = [];
  for (const cell of line.cells) {
    const words = cell.text.trim().split(/\s+/).filter(Boolean);
    words.forEach((w, i) =>
      out.push({ text: w, right: i === words.length - 1 ? cell.right : null }),
    );
  }
  // "$ 12.00" and "- 12.00" are one amount.
  for (let i = out.length - 2; i >= 0; i--) {
    if ((out[i]!.text === "$" || out[i]!.text === "-") && /^\(?\$?\d/.test(out[i + 1]!.text)) {
      out[i + 1] = { ...out[i + 1]!, text: out[i]!.text + out[i + 1]!.text };
      out.splice(i, 1);
    }
  }
  return out;
}

const AMOUNT = /^[-+]?\(?[-+]?\$?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\)?-?$/;

type Amount = {
  /** Size in cents, always positive. */
  cents: number;
  /** "-" or parentheses: negative in the statement's own terms. */
  minus: boolean;
  /** CR or DR printed beside it: which way the money moved, for certain. */
  marker: "CR" | "DR" | null;
  right: number | null;
};

function readAmount(text: string, marker: Amount["marker"], right: number | null): Amount {
  const minus = /^[-+]?\(|^-|-$/.test(text) && !/^\+/.test(text);
  const digits = text.replace(/[^\d.]/g, "");
  const [whole, frac] = digits.split(".");
  return { cents: Number(whole) * 100 + Number(frac), minus, marker, right };
}

/** Takes amounts off the end of the line: "12.00", "(12.00)", "12.00-", "12.00 CR". */
function peelAmounts(tokens: Token[]): { rest: Token[]; amounts: Amount[] } {
  const rest = [...tokens];
  const amounts: Amount[] = [];
  while (rest.length) {
    const last = rest[rest.length - 1]!;
    const prev = rest[rest.length - 2];
    if (/^(CR|DR)$/i.test(last.text) && prev && AMOUNT.test(prev.text)) {
      amounts.unshift(readAmount(prev.text, last.text.toUpperCase() as "CR" | "DR", last.right));
      rest.splice(-2, 2);
    } else if (/^\$?[\d,]+\.\d{2}(CR|DR)$/i.test(last.text)) {
      const m = last.text.slice(-2).toUpperCase() as "CR" | "DR";
      amounts.unshift(readAmount(last.text.slice(0, -2), m, last.right));
      rest.pop();
    } else if (AMOUNT.test(last.text)) {
      amounts.unshift(readAmount(last.text, null, last.right));
      rest.pop();
    } else break;
  }
  return { rest, amounts };
}

/* ---------- Dates ---------- */

type DateParts = { y: number | null; m: number; d: number; dayFirst: boolean | null };

/** A date at the start of the token list, and how many tokens it used. */
function readDate(tokens: Token[], at: number): { parts: DateParts; used: number } | null {
  const t = tokens[at]?.text;
  if (!t) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return { parts: { y: +m[1]!, m: +m[2]!, d: +m[3]!, dayFirst: false }, used: 1 };
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/.exec(t);
  if (m) {
    const a = +m[1]!;
    const b = +m[2]!;
    if (a < 1 || b < 1 || a > 31 || b > 31) return null;
    const y = m[3] ? fullYear(+m[3]) : null;
    return {
      parts: { y, m: a, d: b, dayFirst: a > 12 ? true : b > 12 ? false : null },
      used: 1,
    };
  }
  const month = monthIndex(t);
  if (month >= 0) {
    const day = /^(\d{1,2}),?$/.exec(tokens[at + 1]?.text ?? "");
    if (!day) return null;
    const year = /^(\d{4})$/.exec(tokens[at + 2]?.text ?? "");
    return {
      parts: { y: year ? +year[1]! : null, m: month + 1, d: +day[1]!, dayFirst: false },
      used: year ? 3 : 2,
    };
  }
  // "05Jan" or "Jan05" on some card statements.
  m = /^(\d{1,2})([A-Za-z]{3})$/.exec(t) ?? null;
  if (m && monthIndex(m[2]!) >= 0)
    return { parts: { y: null, m: monthIndex(m[2]!) + 1, d: +m[1]!, dayFirst: true }, used: 1 };
  return null;
}

/** Full dates anywhere in a line of text, for finding the statement period. */
function fullDatesIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g)) {
    const v = isoOf(fullYear(+m[3]!), +m[1]!, +m[2]!);
    if (v) out.push(v);
  }
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const v = isoOf(+m[1]!, +m[2]!, +m[3]!);
    if (v) out.push(v);
  }
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const i = monthIndex(m[1]!);
    if (i >= 0) {
      const v = isoOf(+m[3]!, i + 1, +m[2]!);
      if (v) out.push(v);
    }
  }
  return out;
}

function findPeriod(lines: PdfLine[]): { start: string | null; end: string | null } {
  const texts = lines.map(lineText);
  // "01/01/2026 - 01/31/2026", "January 1, 2026 through January 31, 2026".
  for (const text of texts) {
    if (!/\b(to|through|thru)\b|\s[-]\s|\d\s?-\s?[A-Za-z\d]/i.test(text)) continue;
    const dates = fullDatesIn(text);
    for (let i = 0; i + 1 < dates.length; i++) {
      const gap = dayNum(dates[i + 1]!) - dayNum(dates[i]!);
      if (gap > 0 && gap <= 95) return { start: dates[i]!, end: dates[i + 1]! };
    }
  }
  const all = texts.flatMap(fullDatesIn).sort();
  return { start: null, end: all.length ? all[all.length - 1]! : null };
}

/* ---------- Statement structure ---------- */

const lineText = (l: PdfLine) => l.cells.map((c) => c.text.trim()).join(" ");

type Column = "out" | "in" | "amount" | "balance";

/** Column headings on this line, if it is a table header. */
function readHeader(line: PdfLine): { kind: Column; right: number }[] | null {
  const found: { kind: Column; right: number }[] = [];
  for (const c of line.cells) {
    const t = c.text.trim().toLowerCase();
    let kind: Column | null = null;
    if (/balance/.test(t)) kind = "balance";
    else if (/withdrawal|debit|money out|subtraction|charges?$|amount out|paid out/.test(t))
      kind = "out";
    else if (/deposit|credit|money in|addition|amount in|paid in/.test(t)) kind = "in";
    else if (/^amount\b|\bamount$/.test(t)) kind = "amount";
    if (kind) found.push({ kind, right: c.right });
  }
  const hasDateWord = line.cells.some((c) => /\bdate\b/i.test(c.text));
  return found.length >= 2 || (found.length >= 1 && hasDateWord) ? found : null;
}

/** A heading such as "Deposits and additions" that says which way the rows below move. */
function sectionSign(text: string, kind: AccountKind): 1 | -1 | null {
  const t = text.toLowerCase();
  if (t.split(/\s+/).length > 7) return null;
  if (
    /payments?,? (and|&) (other )?credits|credits?\b|deposits?|additions|interest (paid|earned)|refunds?/.test(
      t,
    )
  )
    return 1;
  if (
    /withdrawals?|debits?|checks? (paid|cleared)|fees?\b|purchases?|charges?|atm|card (transactions|activity)|interest charged|cash advances?/.test(
      t,
    )
  )
    return -1;
  if (/^payments?\b/.test(t)) return kind === "liability" ? 1 : -1;
  return null;
}

const OPENING =
  /\b(beginning|opening|starting|previous|prior) balance\b|balance (forward|brought forward)/i;
const NOT_A_TRANSACTION =
  /^(total|subtotal)\b|\b(beginning|ending|opening|closing|starting|previous|prior|new|daily( ending)?|available|statement) balance\b|balance (forward|brought forward)|minimum payment|payment due|credit limit|available credit/i;

/* ---------- The reader ---------- */

type Draft = {
  parts: DateParts;
  description: string;
  page: number;
  y: number;
  left: number;
  amount: Amount;
  column: Column | null;
  balance: Amount | null;
  section: 1 | -1 | null;
  continued: number;
};

/**
 * Turns a statement's lines into transactions. Amounts are signed the way the
 * book sees them: money out of a bank account, and charges on a card, are negative.
 */
export function readStatement(lines: PdfLine[], kind: AccountKind, today: string): StatementResult {
  const notes: string[] = [];
  const period = findPeriod(lines);
  const drafts: Draft[] = [];
  let columns: { kind: Column; right: number }[] = [];
  let columnsPage = -1;
  let section: 1 | -1 | null = null;
  let opening: Amount | null = null;

  for (const line of lines) {
    if (line.page !== columnsPage) columns = [];
    const text = lineText(line);
    const header = readHeader(line);
    const tokens = tokenize(line);
    const { rest, amounts } = peelAmounts(tokens);

    if (header && amounts.length === 0) {
      columns = header;
      columnsPage = line.page;
      continue;
    }

    const dates: DateParts[] = [];
    let at = 0;
    while (dates.length < 2) {
      const d = readDate(rest, at);
      if (!d) break;
      dates.push(d.parts);
      at += d.used;
    }
    const description = rest
      .slice(at)
      .map((t) => t.text)
      .join(" ")
      .trim();

    if (dates.length === 0 || amounts.length === 0 || !/[A-Za-z]/.test(description)) {
      if (amounts.length && OPENING.test(text)) opening = amounts[amounts.length - 1]!;
      // A line with no date and no amount right under a transaction carries on its description.
      const last = drafts[drafts.length - 1];
      if (
        dates.length === 0 &&
        amounts.length === 0 &&
        last &&
        last.page === line.page &&
        last.continued < 2 &&
        last.y - line.y > 0 &&
        last.y - line.y < line.height * 2.2 &&
        (line.cells[0]?.x ?? 0) > last.left + 4 &&
        !header &&
        sectionSign(text, kind) === null &&
        !NOT_A_TRANSACTION.test(text)
      ) {
        last.description = `${last.description} ${text}`.slice(0, 500);
        last.continued += 1;
        last.y = line.y;
        continue;
      }
      if (amounts.length === 0) {
        const s = sectionSign(text, kind);
        if (s !== null) section = s;
      }
      continue;
    }
    if (NOT_A_TRANSACTION.test(description)) {
      if (OPENING.test(description)) opening = amounts[amounts.length - 1]!;
      continue;
    }

    // Which amount is the transaction and which is the running balance.
    let amount: Amount;
    let column: Column | null = null;
    let balance: Amount | null = null;
    const nearest = (a: Amount) => {
      if (a.right == null || columns.length === 0) return null;
      let best: { kind: Column; right: number } | null = null;
      for (const c of columns)
        if (!best || Math.abs(c.right - a.right) < Math.abs(best.right - a.right)) best = c;
      return best && Math.abs(best.right - a.right) < 70 ? best.kind : null;
    };
    const kinds = amounts.map(nearest);
    const txIndex = kinds.findIndex((k) => k === "out" || k === "in" || k === "amount");
    if (txIndex >= 0) {
      amount = amounts[txIndex]!;
      column = kinds[txIndex]!;
      const b = kinds.indexOf("balance");
      balance = b >= 0 ? amounts[b]! : null;
    } else if (amounts.length >= 2) {
      amount = amounts[amounts.length - 2]!;
      balance = amounts[amounts.length - 1]!;
    } else amount = amounts[0]!;
    if (amount.cents === 0) continue;

    drafts.push({
      // The posting date is the last of two leading dates (transaction date, posted date).
      parts: dates[dates.length - 1]!,
      description,
      page: line.page,
      y: line.y,
      left: line.cells[0]?.x ?? 0,
      amount,
      column,
      balance,
      section,
      continued: 0,
    });
  }

  // Day-first dates (31/01) if any date on the statement only reads that way.
  const dayFirst = drafts.some((d) => d.parts.dayFirst === true);
  const anyMinus = drafts.some((d) => d.amount.minus);
  const end = period.end ?? today;
  let guessedYear = false;
  let previousBalance = opening;
  const rows: StatementRow[] = [];

  for (const d of drafts) {
    let month = d.parts.m;
    let day = d.parts.d;
    if (dayFirst && d.parts.dayFirst !== false) [month, day] = [day, month];
    let year = d.parts.y;
    if (year == null) {
      year = Number(end.slice(0, 4));
      if (!period.end) guessedYear = true;
      // A December row on a statement that closes in January belongs to last year.
      const candidate = isoOf(year, month, day);
      if (candidate && dayNum(candidate) > dayNum(end) + 7) year -= 1;
    }
    const postedDate = isoOf(year, month, day);
    if (!postedDate) continue;

    const a = d.amount;
    let sign: 1 | -1;
    let guessed = false;
    const delta =
      d.balance && previousBalance
        ? signedBalance(d.balance) - signedBalance(previousBalance)
        : null;
    if (a.marker) sign = a.marker === "CR" ? 1 : -1;
    else if (d.column === "out") sign = -1;
    else if (d.column === "in") sign = 1;
    else if (delta !== null && Math.abs(delta) === a.cents) {
      // A card's balance is what you owe, so it rises with a purchase.
      const up = delta > 0 ? 1 : -1;
      sign = (kind === "liability" ? -up : up) as 1 | -1;
    } else if (a.minus) sign = kind === "liability" ? 1 : -1;
    else if (d.section !== null) sign = d.section;
    else if (kind === "liability") sign = -1;
    else if (anyMinus) sign = 1;
    else {
      sign = -1;
      guessed = true;
    }
    if (d.balance) previousBalance = d.balance;
    else previousBalance = null;

    rows.push({
      line: rows.length + 1,
      page: d.page,
      postedDate,
      amountCents: sign * a.cents,
      description: d.description.replace(/\s+/g, " ").slice(0, 500),
      signGuessed: guessed,
    });
  }

  if (guessedYear && rows.length)
    notes.push(`No statement dates were found, so the rows are dated in ${end.slice(0, 4)}.`);
  if (rows.some((r) => r.signGuessed))
    notes.push("The statement doesn't say which rows are money in, so check the marked rows.");
  return { rows, periodStart: period.start, periodEnd: period.end, notes };
}

function signedBalance(a: Amount): number {
  const negative = a.marker === "DR" || a.minus;
  return negative ? -a.cents : a.cents;
}
