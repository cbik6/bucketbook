/**
 * Chart of accounts vocabulary shared by the server, the UI and the templates.
 * Stored values are lowercase snake_case; labels are what people see.
 */

export const ACCOUNT_TYPES = ["asset", "liability", "equity", "income", "expense"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  asset: "Assets",
  liability: "Liabilities",
  equity: "Equity",
  income: "Income",
  expense: "Expenses",
};

export const ACCOUNT_TYPE_SINGULAR: Record<AccountType, string> = {
  asset: "Asset",
  liability: "Liability",
  equity: "Equity",
  income: "Income",
  expense: "Expense",
};

/** Debit-normal accounts grow with debits; the rest grow with credits. */
export const NORMAL_BALANCE: Record<AccountType, "debit" | "credit"> = {
  asset: "debit",
  expense: "debit",
  liability: "credit",
  equity: "credit",
  income: "credit",
};

export const ACCOUNT_SUBTYPES = {
  asset: {
    bank: "Bank",
    cash: "Cash",
    other_current_asset: "Other Current Asset",
    fixed_asset: "Fixed Asset",
    other_asset: "Other Asset",
  },
  liability: {
    credit_card: "Credit Card",
    loan: "Loan",
    other_current_liability: "Other Current Liability",
    long_term_liability: "Long Term Liability",
  },
  equity: {
    opening_balance: "Opening Balance",
    retained_earnings: "Retained Earnings",
    owner_equity: "Owner Equity",
    other_equity: "Other Equity",
  },
  income: {
    income: "Income",
    other_income: "Other Income",
  },
  expense: {
    expense: "Expense",
    cost_of_goods_sold: "Cost of Goods Sold",
    other_expense: "Other Expense",
  },
} as const satisfies Record<AccountType, Record<string, string>>;

export type AccountSubtype = {
  [T in AccountType]: keyof (typeof ACCOUNT_SUBTYPES)[T];
}[AccountType];

export const ALL_SUBTYPES = Object.values(ACCOUNT_SUBTYPES).flatMap((m) =>
  Object.keys(m),
) as AccountSubtype[];

export function isAccountType(value: string): value is AccountType {
  return (ACCOUNT_TYPES as readonly string[]).includes(value);
}

export function isSubtypeOf(type: AccountType, subtype: string): boolean {
  return Object.hasOwn(ACCOUNT_SUBTYPES[type], subtype);
}

export function subtypeLabel(type: AccountType, subtype: string): string {
  const map = ACCOUNT_SUBTYPES[type] as Record<string, string>;
  return map[subtype] ?? subtype;
}

/**
 * Accounts the app itself depends on. Each role exists at most once per book.
 * Phase 2 posts opening balances to `opening_balance_equity`; reports close net
 * income into `retained_earnings`.
 */
export const SYSTEM_ROLES = ["opening_balance_equity", "retained_earnings"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

export const BOOK_TEMPLATES = ["household", "small_business", "blank"] as const;
export type BookTemplate = (typeof BOOK_TEMPLATES)[number];

export const BOOK_ROLES = ["owner", "editor", "viewer"] as const;
export type BookRole = (typeof BOOK_ROLES)[number];
