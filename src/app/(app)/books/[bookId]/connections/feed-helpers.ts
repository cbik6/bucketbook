import type { FeedView } from "@/server/simplefin/service";

export const NEW_KINDS = [
  { kind: "checking", label: "Checking" },
  { kind: "savings", label: "Savings" },
  { kind: "credit_card", label: "Credit card" },
  { kind: "investment", label: "Investment (value only)" },
  { kind: "loan", label: "Loan" },
  { kind: "cash", label: "Cash" },
  { kind: "other_asset", label: "Other asset" },
] as const;

export type NewKind = (typeof NEW_KINDS)[number]["kind"];

/** A tidy starting name from the bank's ("Costco Anywhere Visa® Card by Citi (8837)"). */
export const startingName = (feedName: string) =>
  feedName.replace(/[®™]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);

/** A first guess at what kind of account a bank account is, from its name and balance. */
export function guessKind(feed: FeedView): NewKind {
  const n = feed.name.toLowerCase();
  if (/(card|visa|mastercard|amex|discover)/.test(n)) return "credit_card";
  if (/(brokerage|ira\b|401|403|roth|invest|retire|hsa|stock|fund\b.*index)/.test(n))
    return "investment";
  if (/(loan|mortgage|auto|heloc)/.test(n)) return "loan";
  if ((feed.balanceCents ?? 0) < 0) return "credit_card";
  if (/(sav|fund|reserve|goal|money market|cd\b)/.test(n)) return "savings";
  return "checking";
}
