import type { AccountSubtype, AccountType, BookTemplate, SystemRole } from "@/lib/account-types";

export type TemplateAccount = {
  name: string;
  subtype: AccountSubtype;
  code?: string;
  description?: string;
  systemRole?: SystemRole;
  children?: TemplateAccount[];
};

/** Top-level accounts grouped by type. Children inherit their parent's type. */
export type ChartTemplate = {
  id: BookTemplate;
  label: string;
  description: string;
  accounts: Record<AccountType, TemplateAccount[]>;
};
