import type { TemplateAccount } from "./types";

/** Every book gets these two equity accounts; the app relies on them. */
export function systemEquityAccounts(codes?: {
  opening: string;
  retained: string;
}): TemplateAccount[] {
  return [
    {
      name: "Opening Balance Equity",
      subtype: "opening_balance",
      systemRole: "opening_balance_equity",
      code: codes?.opening,
      description: "Offset for the starting balances you enter when setting up a book.",
    },
    {
      name: "Retained Earnings",
      subtype: "retained_earnings",
      systemRole: "retained_earnings",
      code: codes?.retained,
      description: "Net income from prior years, closed in automatically by reports.",
    },
  ];
}
