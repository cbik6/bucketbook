import { z } from "zod";
import { formatCents } from "./money";

/**
 * Categorization rules. A rule has conditions (all must match) and actions.
 * Rules run in priority order, lowest number first; for each action the first
 * matching rule that sets it wins, so a broad rule lower down can fill in
 * what a specific rule leaves empty. Rules only suggest: nothing posts until
 * you approve it.
 */

export const TEXT_FIELDS = ["any", "payee", "description"] as const;
export const TEXT_OPS = ["contains", "equals", "starts_with", "regex"] as const;
export const DIRECTIONS = ["any", "outflow", "inflow"] as const;

export const TEXT_OP_LABELS: Record<(typeof TEXT_OPS)[number], string> = {
  contains: "contains",
  equals: "is exactly",
  starts_with: "starts with",
  regex: "matches pattern",
};

export const MAX_REGEX_LENGTH = 200;

const uuid = z.uuid();

function regexProblem(source: string): string | null {
  if (source.length > MAX_REGEX_LENGTH)
    return `Keep patterns under ${MAX_REGEX_LENGTH} characters.`;
  try {
    new RegExp(source, "i");
  } catch {
    return "That pattern isn't a valid regular expression.";
  }
  // Nested quantifiers such as (a+)+ can take forever on some text.
  if (/\([^)]*[+*][^)]*\)[+*{]/.test(source)) {
    return "That pattern repeats a repeated group, which can be very slow. Simplify it.";
  }
  return null;
}

export const ruleConditionsSchema = z
  .object({
    text: z
      .object({
        field: z.enum(TEXT_FIELDS).default("any"),
        op: z.enum(TEXT_OPS).default("contains"),
        value: z.string().trim().min(1, "Enter the text to look for.").max(200),
      })
      .superRefine((t, ctx) => {
        if (t.op === "regex") {
          const problem = regexProblem(t.value);
          if (problem) ctx.addIssue({ code: "custom", message: problem, path: ["value"] });
        }
      })
      .nullish(),
    amount: z
      .object({
        /** Compared with the size of the amount; direction is separate. */
        minCents: z.number().int().nonnegative().nullish(),
        maxCents: z.number().int().nonnegative().nullish(),
      })
      .refine((a) => a.minCents != null || a.maxCents != null, "Enter an amount.")
      .refine(
        (a) => a.minCents == null || a.maxCents == null || a.minCents <= a.maxCents,
        "The lowest amount must not be above the highest.",
      )
      .nullish(),
    direction: z.enum(DIRECTIONS).default("any"),
    /** Only transactions on this bank or card account. */
    accountId: uuid.nullish(),
  })
  .refine(
    (c) => c.text || c.amount || c.accountId || c.direction !== "any",
    "Add at least one condition.",
  );

export const ruleActionsSchema = z
  .object({
    offsetAccountId: uuid.nullish(),
    bucketAccountId: uuid.nullish(),
    payee: z.string().trim().max(200).nullish(),
    memo: z.string().trim().max(500).nullish(),
    transfer: z.boolean().default(false),
  })
  .refine(
    (a) => a.offsetAccountId || a.bucketAccountId || a.payee || a.memo || a.transfer,
    "Pick at least one thing for the rule to do.",
  );

export type RuleConditions = z.infer<typeof ruleConditionsSchema>;
export type RuleActions = z.infer<typeof ruleActionsSchema>;

export type Rule = {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleConditions;
  actions: RuleActions;
};

export type RuleSubject = {
  accountId: string;
  amountCents: number;
  description: string;
  payee: string | null;
};

export type Suggestion = {
  offsetAccountId: string | null;
  bucketAccountId: string | null;
  payee: string | null;
  memo: string | null;
  transfer: boolean;
  /** The highest-priority rule that matched. */
  ruleId: string | null;
};

const EMPTY: Suggestion = {
  offsetAccountId: null,
  bucketAccountId: null,
  payee: null,
  memo: null,
  transfer: false,
  ruleId: null,
};

const norm = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();

function textMatches(
  cond: NonNullable<RuleConditions["text"]>,
  subject: RuleSubject,
  regexCache: Map<string, RegExp | null>,
): boolean {
  const values =
    cond.field === "payee"
      ? [subject.payee ?? ""]
      : cond.field === "description"
        ? [subject.description]
        : [subject.payee ?? "", subject.description];
  if (cond.op === "regex") {
    let re = regexCache.get(cond.value);
    if (re === undefined) {
      re = regexProblem(cond.value) ? null : new RegExp(cond.value, "i");
      regexCache.set(cond.value, re);
    }
    return re ? values.some((v) => re.test(v)) : false;
  }
  const needle = norm(cond.value);
  return values.some((raw) => {
    const v = norm(raw);
    if (!v) return false;
    if (cond.op === "equals") return v === needle;
    if (cond.op === "starts_with") return v.startsWith(needle);
    return v.includes(needle);
  });
}

export function ruleMatches(
  rule: Pick<Rule, "conditions">,
  subject: RuleSubject,
  regexCache = new Map<string, RegExp | null>(),
): boolean {
  const c = rule.conditions;
  if (c.accountId && c.accountId !== subject.accountId) return false;
  if (c.direction === "outflow" && subject.amountCents >= 0) return false;
  if (c.direction === "inflow" && subject.amountCents <= 0) return false;
  if (c.amount) {
    const size = Math.abs(subject.amountCents);
    if (c.amount.minCents != null && size < c.amount.minCents) return false;
    if (c.amount.maxCents != null && size > c.amount.maxCents) return false;
  }
  if (c.text && !textMatches(c.text, subject, regexCache)) return false;
  return true;
}

export function evaluateRules(rules: Rule[], subject: RuleSubject): Suggestion {
  const ordered = rules.filter((r) => r.enabled).sort((a, b) => a.priority - b.priority);
  const out: Suggestion = { ...EMPTY };
  const cache = new Map<string, RegExp | null>();
  for (const rule of ordered) {
    if (!ruleMatches(rule, subject, cache)) continue;
    out.ruleId ??= rule.id;
    const a = rule.actions;
    if (a.offsetAccountId && !out.offsetAccountId) out.offsetAccountId = a.offsetAccountId;
    if (a.bucketAccountId && !out.bucketAccountId) out.bucketAccountId = a.bucketAccountId;
    if (a.payee && !out.payee) out.payee = a.payee;
    if (a.memo && !out.memo) out.memo = a.memo;
    if (a.transfer) out.transfer = true;
  }
  return out;
}

/** Plain-language summary of a rule's conditions, for the rules list. */
export function describeConditions(c: RuleConditions, accountName: (id: string) => string): string {
  const parts: string[] = [];
  if (c.text) {
    const where =
      c.text.field === "any"
        ? "payee or description"
        : c.text.field === "payee"
          ? "payee"
          : "description";
    parts.push(`${where} ${TEXT_OP_LABELS[c.text.op]} "${c.text.value}"`);
  }
  if (c.direction === "outflow") parts.push("money out");
  if (c.direction === "inflow") parts.push("money in");
  if (c.amount) {
    const f = (n: number) => formatCents(n);
    const { minCents: lo, maxCents: hi } = c.amount;
    if (lo != null && hi != null)
      parts.push(lo === hi ? `amount is ${f(lo)}` : `amount ${f(lo)} to ${f(hi)}`);
    else if (lo != null) parts.push(`amount at least ${f(lo)}`);
    else if (hi != null) parts.push(`amount at most ${f(hi)}`);
  }
  if (c.accountId) parts.push(`on ${accountName(c.accountId)}`);
  return parts.join(", ");
}

/** A short, readable payee name from a bank description, used to seed "Save as rule". */
export function payeeKey(subject: Pick<RuleSubject, "payee" | "description">): string {
  return (subject.payee ?? subject.description).replace(/\s+/g, " ").trim().slice(0, 200);
}
