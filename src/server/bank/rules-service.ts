import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type Rule,
  type RuleActions,
  type RuleConditions,
  evaluateRules,
  ruleActionsSchema,
  ruleConditionsSchema,
} from "@/lib/rules";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { accounts, bankRules, bankTransactions } from "../db/schema";
import { NotFoundError, UserFacingError } from "../errors";

type Actor = { userId: string };

export type RuleRow = Rule & { name: string; bookId: string };

function toRule(row: typeof bankRules.$inferSelect): RuleRow | null {
  const c = ruleConditionsSchema.safeParse(row.conditions);
  const a = ruleActionsSchema.safeParse(row.actions);
  if (!c.success || !a.success) return null;
  return {
    id: row.id,
    bookId: row.bookId,
    name: row.name,
    priority: row.priority,
    enabled: row.enabled,
    conditions: c.data,
    actions: a.data,
  };
}

export async function listRules(db: DbOrTx, bookId: string): Promise<RuleRow[]> {
  const rows = await db
    .select()
    .from(bankRules)
    .where(eq(bankRules.bookId, bookId))
    .orderBy(asc(bankRules.priority), asc(bankRules.createdAt));
  return rows.map(toRule).filter((r): r is RuleRow => r !== null);
}

const ruleInputSchema = z.object({
  name: z.string().trim().min(1, "Give the rule a name.").max(100, "Keep the name short."),
  enabled: z.boolean().default(true),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
});

export type RuleInput = z.input<typeof ruleInputSchema>;

function parseRuleInput(raw: unknown) {
  const result = ruleInputSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  return result.data;
}

/** Every account a rule names must be in the same book and usable. */
async function checkRuleAccounts(
  tx: DbOrTx,
  bookId: string,
  conditions: RuleConditions,
  actions: RuleActions,
) {
  const ids = [conditions.accountId, actions.offsetAccountId, actions.bucketAccountId].filter(
    (v): v is string => Boolean(v),
  );
  if (ids.length === 0) return;
  const rows = await tx
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      allowsPosting: accounts.allowsPosting,
      isBucket: accounts.isBucket,
    })
    .from(accounts)
    .where(and(eq(accounts.bookId, bookId), inArray(accounts.id, ids)));
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    if (!byId.has(id)) throw new UserFacingError("One of the rule's accounts isn't in this book.");
  }
  if (actions.offsetAccountId && !byId.get(actions.offsetAccountId)!.allowsPosting) {
    throw new UserFacingError(
      `${byId.get(actions.offsetAccountId)!.name} holds buckets. Pick one of its buckets.`,
      "actions",
    );
  }
  if (actions.bucketAccountId && !byId.get(actions.bucketAccountId)!.isBucket) {
    throw new UserFacingError("The bucket must be a bucket account.", "actions");
  }
}

export async function createRule(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const input = parseRuleInput(raw);
  return db.transaction(async (tx) => {
    await checkRuleAccounts(tx, bookId, input.conditions, input.actions);
    const next = await tx.execute<{ p: number }>(
      sql`select coalesce(max(priority), 0) + 1 as p from bank_rules where book_id = ${bookId}`,
    );
    const [row] = await tx
      .insert(bankRules)
      .values({
        bookId,
        name: input.name,
        enabled: input.enabled,
        priority: Number(next.rows[0]!.p),
        conditions: input.conditions,
        actions: input.actions,
      })
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_rule",
      entityId: row!.id,
      action: "create",
      after: row,
    });
    await applyRules(tx, bookId);
    return row!;
  });
}

async function loadRule(tx: DbOrTx, bookId: string, ruleId: string) {
  if (!z.uuid().safeParse(ruleId).success) throw new NotFoundError("That rule");
  const [row] = await tx
    .select()
    .from(bankRules)
    .where(and(eq(bankRules.id, ruleId), eq(bankRules.bookId, bookId)));
  if (!row) throw new NotFoundError("That rule");
  return row;
}

export async function updateRule(
  db: Database,
  actor: Actor,
  bookId: string,
  ruleId: string,
  raw: unknown,
) {
  const input = parseRuleInput(raw);
  return db.transaction(async (tx) => {
    const before = await loadRule(tx, bookId, ruleId);
    await checkRuleAccounts(tx, bookId, input.conditions, input.actions);
    const [after] = await tx
      .update(bankRules)
      .set({
        name: input.name,
        enabled: input.enabled,
        conditions: input.conditions,
        actions: input.actions,
      })
      .where(eq(bankRules.id, ruleId))
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_rule",
      entityId: ruleId,
      action: "update",
      before,
      after,
    });
    await applyRules(tx, bookId);
    return after!;
  });
}

export async function deleteRule(db: Database, actor: Actor, bookId: string, ruleId: string) {
  return db.transaction(async (tx) => {
    const before = await loadRule(tx, bookId, ruleId);
    await tx
      .update(bankTransactions)
      .set({ suggestedRuleId: null })
      .where(eq(bankTransactions.suggestedRuleId, ruleId));
    await tx.delete(bankRules).where(eq(bankRules.id, ruleId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_rule",
      entityId: ruleId,
      action: "delete",
      before,
    });
    await applyRules(tx, bookId);
  });
}

/** Moves a rule one place up (earlier, wins more) or down. */
export async function moveRule(
  db: Database,
  actor: Actor,
  bookId: string,
  ruleId: string,
  direction: "up" | "down",
) {
  return db.transaction(async (tx) => {
    await loadRule(tx, bookId, ruleId);
    const rows = await tx
      .select({ id: bankRules.id })
      .from(bankRules)
      .where(eq(bankRules.bookId, bookId))
      .orderBy(asc(bankRules.priority), asc(bankRules.createdAt));
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(ruleId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (const [index, id] of ids.entries()) {
      await tx
        .update(bankRules)
        .set({ priority: index + 1 })
        .where(eq(bankRules.id, id));
    }
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bank_rule",
      entityId: ruleId,
      action: "update",
      after: { moved: direction },
    });
    await applyRules(tx, bookId);
  });
}

/**
 * Recomputes rule suggestions for transactions still waiting (pending or in
 * review). Pass ids to limit it to new arrivals.
 */
export async function applyRules(tx: DbOrTx, bookId: string, onlyIds?: string[]) {
  if (onlyIds && onlyIds.length === 0) return;
  const rules = await listRules(tx, bookId);
  const conditions = [
    eq(bankTransactions.bookId, bookId),
    inArray(bankTransactions.status, ["pending", "review"]),
  ];
  if (onlyIds) conditions.push(inArray(bankTransactions.id, onlyIds));
  const items = await tx
    .select({
      id: bankTransactions.id,
      accountId: bankTransactions.accountId,
      amountCents: bankTransactions.amountCents,
      description: bankTransactions.description,
      payee: bankTransactions.payee,
      suggestedAccountId: bankTransactions.suggestedAccountId,
      suggestedBucketId: bankTransactions.suggestedBucketId,
      suggestedPayee: bankTransactions.suggestedPayee,
      suggestedMemo: bankTransactions.suggestedMemo,
      suggestedTransfer: bankTransactions.suggestedTransfer,
      suggestedRuleId: bankTransactions.suggestedRuleId,
    })
    .from(bankTransactions)
    .where(and(...conditions));
  for (const item of items) {
    const s = evaluateRules(rules, item);
    if (
      s.offsetAccountId === item.suggestedAccountId &&
      s.bucketAccountId === item.suggestedBucketId &&
      s.payee === item.suggestedPayee &&
      s.memo === item.suggestedMemo &&
      s.transfer === item.suggestedTransfer &&
      s.ruleId === item.suggestedRuleId
    ) {
      continue;
    }
    await tx
      .update(bankTransactions)
      .set({
        suggestedAccountId: s.offsetAccountId,
        suggestedBucketId: s.bucketAccountId,
        suggestedPayee: s.payee,
        suggestedMemo: s.memo,
        suggestedTransfer: s.transfer,
        suggestedRuleId: s.ruleId,
      })
      .where(eq(bankTransactions.id, item.id));
  }
}
