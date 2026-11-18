import { systemEquityAccounts } from "./common";
import type { ChartTemplate } from "./types";

const e = (name: string) => ({ name, subtype: "expense" as const });

export const householdTemplate: ChartTemplate = {
  id: "household",
  label: "Household",
  description: "Everyday family finances: paychecks, bills, groceries, and savings.",
  accounts: {
    // Bank, savings and card accounts are added by you (or while connecting a
    // bank), so there are no placeholders to rename or delete.
    asset: [{ name: "Cash on Hand", subtype: "cash" }],
    liability: [],
    equity: systemEquityAccounts(),
    income: [
      { name: "Paychecks", subtype: "income" },
      { name: "Interest Earned", subtype: "other_income" },
      { name: "Gifts Received", subtype: "other_income" },
      { name: "Other Income", subtype: "other_income" },
    ],
    expense: [
      {
        ...e("Home"),
        children: [
          e("Rent or Mortgage"),
          e("Utilities"),
          e("Internet and Phone"),
          e("Home Maintenance"),
        ],
      },
      { ...e("Food"), children: [e("Groceries"), e("Dining Out")] },
      {
        ...e("Transportation"),
        children: [e("Fuel"), e("Car Insurance"), e("Car Maintenance"), e("Parking and Tolls")],
      },
      { ...e("Health"), children: [e("Medical"), e("Pharmacy"), e("Health Insurance")] },
      {
        ...e("Personal"),
        children: [e("Clothing"), e("Personal Care"), e("Subscriptions")],
      },
      { ...e("Fun"), children: [e("Entertainment"), e("Hobbies"), e("Travel")] },
      { ...e("Giving"), children: [e("Charity"), e("Gifts Given")] },
      e("Bank Fees"),
      e("Taxes"),
    ],
  },
};
