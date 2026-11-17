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
