import type { BookTemplate } from "@/lib/account-types";
import { systemEquityAccounts } from "./common";
import { householdTemplate } from "./household";
import { smallBusinessTemplate } from "./small-business";
import type { ChartTemplate } from "./types";

export const blankTemplate: ChartTemplate = {
  id: "blank",
  label: "Blank",
  description: "Only the two equity accounts the app needs. Build the rest yourself.",
  accounts: {
    asset: [],
    liability: [],
    equity: systemEquityAccounts(),
    income: [],
    expense: [],
  },
};

export const CHART_TEMPLATES: Record<BookTemplate, ChartTemplate> = {
  household: householdTemplate,
  small_business: smallBusinessTemplate,
  blank: blankTemplate,
};

/** Display order in the wizard. */
export const TEMPLATE_ORDER: BookTemplate[] = ["household", "small_business", "blank"];

export type { ChartTemplate, TemplateAccount } from "./types";

export type TemplateSummary = {
  id: BookTemplate;
  label: string;
  description: string;
  accountCount: number;
  examples: string[];
};

function countAccounts(list: import("./types").TemplateAccount[]): number {
  return list.reduce((n, a) => n + 1 + countAccounts(a.children ?? []), 0);
}

/** Plain data for the template picker (safe to send to the browser). */
export function templateSummaries(): TemplateSummary[] {
  return TEMPLATE_ORDER.map((id) => {
    const t = CHART_TEMPLATES[id];
    const all = Object.values(t.accounts);
    const examples = [...t.accounts.expense, ...t.accounts.income, ...t.accounts.asset]
      .slice(0, 4)
      .map((a) => a.name);
    return {
      id,
      label: t.label,
      description: t.description,
      accountCount: all.reduce((n, list) => n + countAccounts(list), 0),
      examples,
    };
  });
}
