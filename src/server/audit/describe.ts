import { formatEntryNumber } from "@/lib/ledger-math";

export type AuditRowLike = {
  entityType: string;
  entityId: string;
  action: string;
  beforeData: unknown;
  afterData: unknown;
};

export type AuditDescription = {
  summary: string;
  details: string[];
  link?: { kind: "account" | "entry"; id: string };
};

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" ? (v as Obj) : {});
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "blank" : String(v));

const ACCOUNT_FIELDS: [string, string][] = [
  ["name", "Name"],
  ["code", "Number"],
  ["type", "Type"],
  ["subtype", "Detail type"],
  ["parentAccountId", "Parent"],
  ["description", "Description"],
];

/**
 * Turns an audit row into a plain sentence plus the fields that changed.
 * The raw before and after JSON stays in the database for anyone who needs it.
 */
export function describeAudit(
  row: AuditRowLike,
  accountNames: Map<string, string>,
): AuditDescription {
  const before = obj(row.beforeData);
  const after = obj(row.afterData);
  const name = (after.name ?? before.name ?? "an account") as string;

  if (row.entityType === "account") {
    const link = { kind: "account" as const, id: row.entityId };
    switch (row.action) {
      case "create":
        return {
          summary: `Created account ${name}`,
          details:
            typeof after.source === "string" && after.source.startsWith("template:")
              ? ["From the book's template"]
              : [],
          link,
        };
      case "archive":
        return { summary: `Archived account ${name}`, details: [], link };
      case "unarchive":
        return { summary: `Restored account ${name}`, details: [], link };
      case "delete":
        return { summary: `Deleted account ${name}`, details: [] };
      default: {
        const details = ACCOUNT_FIELDS.filter(([k]) => before[k] !== after[k]).map(([k, label]) => {
          const show = (v: unknown) =>
            k === "parentAccountId"
              ? v
                ? (accountNames.get(String(v)) ?? "another account")
                : "top level"
              : str(v);
          return `${label}: ${show(before[k])} to ${show(after[k])}`;
        });
        const renamed = before.name !== after.name;
        return {
          summary: renamed
            ? `Renamed account ${str(before.name)} to ${str(after.name)}`
            : `Changed account ${name}`,
          details: renamed ? details.filter((d) => !d.startsWith("Name:")) : details,
          link,
        };
      }
    }
  }

  if (row.entityType === "journal_entry") {
    const link = { kind: "entry" as const, id: row.entityId };
    const number = (after.entryNumber ?? before.entryNumber) as number | undefined;
    const label = number ? formatEntryNumber(number) : "a journal entry";
    switch (row.action) {
      case "create": {
        const kind = after.kind;
        const what =
          kind === "opening_balance"
            ? "opening balances"
            : kind === "reversal"
              ? "reversal"
              : "entry";
        return {
          summary: `Posted ${what} ${label}`,
          details: after.memo ? [String(after.memo)] : [],
          link,
        };
      }
      case "reverse":
        return {
          summary: `Reversed ${label === "a journal entry" ? "an entry" : label}`,
          details: [],
          link,
        };
      default: {
        const details: string[] = [];
        if (before.entryDate !== after.entryDate)
          details.push(`Date: ${str(before.entryDate)} to ${str(after.entryDate)}`);
        if ((before.memo ?? null) !== (after.memo ?? null))
          details.push(`Memo: ${str(before.memo)} to ${str(after.memo)}`);
        const bl = Array.isArray(before.lines) ? before.lines.length : 0;
        const al = Array.isArray(after.lines) ? after.lines.length : 0;
        details.push(bl === al ? "Lines changed" : `Lines: ${bl} to ${al}`);
        return {
          summary: `Edited ${label}, now version ${str(after.currentVersion)}`,
          details,
          link,
        };
      }
    }
  }

  if (row.entityType === "book") {
    switch (row.action) {
      case "create":
        return { summary: `Created book ${str(after.name)}`, details: [] };
      case "archive":
        return { summary: "Archived this book", details: [] };
      case "unarchive":
        return { summary: "Restored this book", details: [] };
      default: {
        const details: string[] = [];
        if (before.name !== after.name)
          details.push(`Name: ${str(before.name)} to ${str(after.name)}`);
        if (before.startDate !== after.startDate)
          details.push(`Start date: ${str(before.startDate)} to ${str(after.startDate)}`);
        return { summary: "Changed book settings", details };
      }
    }
  }

  return { summary: `${row.action} ${row.entityType}`, details: [] };
}
