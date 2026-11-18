import { formatEntryNumber } from "@/lib/ledger-math";
import { formatCents } from "@/lib/money";

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
  link?: { kind: "account" | "entry" | "rules" | "review"; id: string };
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
              : kind === "transfer"
                ? "transfer"
                : kind === "bucket"
                  ? "bucket move"
                  : "entry";
        return {
          summary: `Posted ${what} ${label}`,
          details: [after.payee, after.memo].filter(Boolean).map(String),
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
      case "delete":
        return { summary: `Deleted book ${str(before.name)}`, details: [] };
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

  if (row.entityType === "bank_transaction") {
    const amount = typeof after.amountCents === "number" ? formatCents(after.amountCents) : "";
    const what = [str(after.description), amount].filter((v) => v && v !== "blank").join(", ");
    switch (row.action) {
      case "approve": {
        const how =
          after.method === "transfer"
            ? "Matched a transfer"
            : after.method === "linked"
              ? "Matched to an existing entry"
              : "Approved";
        return {
          summary: `${how}: ${what}`,
          details: [],
          link:
            typeof after.entryId === "string" ? { kind: "entry", id: after.entryId } : undefined,
        };
      }
      case "exclude":
        return { summary: `Excluded from review: ${what}`, details: [] };
      case "restore":
        return { summary: `Returned to review: ${what}`, details: [] };
      case "import":
        return {
          summary: `Imported ${str(after.count)} transactions from a CSV file`,
          details: after.skipped ? [`${str(after.skipped)} already imported, skipped`] : [],
          link: { kind: "review", id: row.entityId },
        };
      default:
        return { summary: "Changed a bank transaction", details: [] };
    }
  }

  if (row.entityType === "bucket_rule") {
    return {
      summary:
        row.action === "create"
          ? "Added a bucket allocation rule"
          : row.action === "delete"
            ? "Removed a bucket allocation rule"
            : "Changed bucket allocation rules",
      details: [],
    };
  }

  if (row.entityType === "bank_rule") {
    const link = { kind: "rules" as const, id: row.entityId };
    const ruleName = str(after.name ?? before.name);
    switch (row.action) {
      case "create":
        return { summary: `Created rule ${ruleName}`, details: [], link };
      case "delete":
        return { summary: `Deleted rule ${ruleName}`, details: [], link };
      default:
        return {
          summary: after.moved ? "Changed rule order" : `Changed rule ${ruleName}`,
          details: [],
          link,
        };
    }
  }

  return { summary: `${row.action} ${row.entityType}`, details: [] };
}
