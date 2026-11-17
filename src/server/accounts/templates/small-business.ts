import { systemEquityAccounts } from "./common";
import type { ChartTemplate } from "./types";

/** Numbered chart in the familiar 1000s to 6000s layout, close to Schedule C lines. */
export const smallBusinessTemplate: ChartTemplate = {
  id: "small_business",
  label: "Small Business",
  description: "A numbered chart for a sole proprietor or single-member LLC, cash basis.",
  accounts: {
    asset: [
      { code: "1010", name: "Business Checking", subtype: "bank" },
      { code: "1020", name: "Business Savings", subtype: "bank" },
      { code: "1500", name: "Equipment", subtype: "fixed_asset" },
      { code: "1510", name: "Accumulated Depreciation", subtype: "fixed_asset" },
    ],
    liability: [
      { code: "2010", name: "Business Credit Card", subtype: "credit_card" },
      { code: "2500", name: "Loans Payable", subtype: "loan" },
    ],
    equity: [
      ...systemEquityAccounts({ opening: "3000", retained: "3900" }),
      { code: "3100", name: "Owner Contributions", subtype: "owner_equity" },
      { code: "3200", name: "Owner Draws", subtype: "owner_equity" },
    ],
    income: [
      { code: "4010", name: "Sales", subtype: "income" },
      { code: "4020", name: "Service Revenue", subtype: "income" },
      { code: "4900", name: "Interest Income", subtype: "other_income" },
      { code: "4910", name: "Other Income", subtype: "other_income" },
    ],
    expense: [
      { code: "5010", name: "Cost of Goods Sold", subtype: "cost_of_goods_sold" },
      { code: "6010", name: "Advertising and Marketing", subtype: "expense" },
      { code: "6020", name: "Bank and Merchant Fees", subtype: "expense" },
      { code: "6030", name: "Car and Truck", subtype: "expense" },
      { code: "6040", name: "Contract Labor", subtype: "expense" },
      { code: "6050", name: "Depreciation", subtype: "expense" },
      { code: "6060", name: "Insurance", subtype: "expense" },
      { code: "6070", name: "Legal and Professional Services", subtype: "expense" },
      { code: "6080", name: "Meals", subtype: "expense" },
      { code: "6090", name: "Office Supplies", subtype: "expense" },
      { code: "6100", name: "Rent or Lease", subtype: "expense" },
      { code: "6110", name: "Repairs and Maintenance", subtype: "expense" },
      { code: "6120", name: "Software and Subscriptions", subtype: "expense" },
      { code: "6130", name: "Taxes and Licenses", subtype: "expense" },
      { code: "6140", name: "Travel", subtype: "expense" },
      { code: "6150", name: "Utilities", subtype: "expense" },
      { code: "6900", name: "Other Expense", subtype: "other_expense" },
    ],
  },
};
