import { type AccountType, NORMAL_BALANCE } from "./account-types";
import { MoneyError, parseCents } from "./money";

/** One line as typed into the entry screen (amounts are still text). */
export type DraftLine = {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
};

export type ParsedLine = {
  accountId: string;
  debitCents: number;
  creditCents: number;
  memo: string | null;
};

export type LineProblem = {
  index: number;
  field: "accountId" | "debit" | "credit";
  message: string;
};

/** A line with no account and no amounts is just an unused row, not an error. */
export function isBlankLine(l: DraftLine): boolean {
  return !l.accountId && !l.debit.trim() && !l.credit.trim() && !l.memo.trim();
}

function amount(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : parseCents(t);
}

/**
 * Turns typed lines into cents and reports every problem it finds, so the
 * entry screen can show live totals and the server can reuse the same rules.
 */
export function parseDraftLines(lines: DraftLine[]): {
  parsed: ParsedLine[];
  problems: LineProblem[];
  debitTotal: number;
  creditTotal: number;
} {
  const parsed: ParsedLine[] = [];
  const problems: LineProblem[] = [];
  let debitTotal = 0;
  let creditTotal = 0;

  lines.forEach((l, index) => {
    if (isBlankLine(l)) return;
    let debitCents = 0;
    let creditCents = 0;
    const before = problems.length;
    try {
      debitCents = amount(l.debit);
    } catch (e) {
      problems.push({ index, field: "debit", message: (e as MoneyError).message });
    }
    try {
      creditCents = amount(l.credit);
    } catch (e) {
      problems.push({ index, field: "credit", message: (e as MoneyError).message });
    }
    const unreadable = problems.length > before;
    if (unreadable) {
      // The amount itself is the problem; don't pile on more messages for this line.
    } else if (debitCents < 0 || creditCents < 0) {
      problems.push({
        index,
        field: debitCents < 0 ? "debit" : "credit",
        message: "Use the other column instead of a negative amount.",
      });
    } else if (debitCents > 0 && creditCents > 0) {
      problems.push({ index, field: "credit", message: "A line is either a debit or a credit." });
    } else if (debitCents === 0 && creditCents === 0) {
      problems.push({ index, field: "debit", message: "Enter a debit or a credit." });
    }
    if (!l.accountId) problems.push({ index, field: "accountId", message: "Pick an account." });

    debitTotal += Math.max(0, debitCents);
    creditTotal += Math.max(0, creditCents);
    parsed.push({
      accountId: l.accountId,
      debitCents,
      creditCents,
      memo: l.memo.trim() || null,
    });
  });

  return { parsed, problems, debitTotal, creditTotal };
}

/**
 * Balance in the account's natural direction: assets and expenses grow with
 * debits, the rest with credits. Positive means a normal balance.
 */
export function naturalBalance(type: AccountType, debitCents: number, creditCents: number): number {
  return NORMAL_BALANCE[type] === "debit" ? debitCents - creditCents : creditCents - debitCents;
}

/** Converts a natural-direction amount back into a debit or credit for posting. */
export function naturalToSides(
  type: AccountType,
  naturalCents: number,
): { debitCents: number; creditCents: number } {
  const debitNormal = NORMAL_BALANCE[type] === "debit";
  const positiveIsDebit = naturalCents >= 0 ? debitNormal : !debitNormal;
  const abs = Math.abs(naturalCents);
  return positiveIsDebit
    ? { debitCents: abs, creditCents: 0 }
    : { debitCents: 0, creditCents: abs };
}

export function formatEntryNumber(n: number): string {
  return `JE ${n}`;
}
