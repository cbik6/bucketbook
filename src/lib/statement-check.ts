import { MoneyError, parseCents } from "./money";

/**
 * Checks imported rows against a statement's beginning and ending balances.
 * Rows use the book's signs (money out is negative). A bank account's
 * balance is what you have, so it moves with the rows; a card's or loan's
 * balance is what you owe, so it moves the other way.
 */

export type BalanceCheck =
  | { state: "empty" }
  | { state: "invalid"; field: "begin" | "end"; message: string }
  | {
      state: "match" | "off";
      beginCents: number;
      endCents: number;
      inCents: number;
      outCents: number;
      expectedEndCents: number;
      /** Statement ending minus the ending these rows give. */
      differenceCents: number;
      /** A single row whose sign, flipped, would make it match. */
      flipLine: number | null;
      /** True when flipping every row would make it match. */
      flipAll: boolean;
    };

type Row = { line: number; amountCents: number };

function readMoney(text: string): number | null | "bad" {
  if (text.trim() === "") return null;
  try {
    return parseCents(text.replace(/\s/g, ""));
  } catch (err) {
    if (err instanceof MoneyError) return "bad";
    throw err;
  }
}

export function checkBalances(
  beginText: string,
  endText: string,
  rows: Row[],
  owed: boolean,
): BalanceCheck {
  const begin = readMoney(beginText);
  const end = readMoney(endText);
  if (begin === "bad")
    return {
      state: "invalid",
      field: "begin",
      message: "Enter the beginning balance as an amount.",
    };
  if (end === "bad")
    return { state: "invalid", field: "end", message: "Enter the ending balance as an amount." };
  if (begin === null || end === null) return { state: "empty" };

  const sum = rows.reduce((s, r) => s + r.amountCents, 0);
  const direction = owed ? -1 : 1;
  const expected = begin + direction * sum;
  const difference = end - expected;
  if (difference === 0) {
    return {
      state: "match",
      beginCents: begin,
      endCents: end,
      inCents: rows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0),
      outCents: rows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0),
      expectedEndCents: expected,
      differenceCents: 0,
      flipLine: null,
      flipAll: false,
    };
  }
  // Flipping a row's sign moves the ending by twice its amount.
  const flip = rows.find((r) => -2 * direction * r.amountCents === difference);
  return {
    state: "off",
    beginCents: begin,
    endCents: end,
    inCents: rows.filter((r) => r.amountCents > 0).reduce((s, r) => s + r.amountCents, 0),
    outCents: rows.filter((r) => r.amountCents < 0).reduce((s, r) => s + r.amountCents, 0),
    expectedEndCents: expected,
    differenceCents: difference,
    flipLine: flip?.line ?? null,
    flipAll: sum !== 0 && begin - direction * sum === end,
  };
}
