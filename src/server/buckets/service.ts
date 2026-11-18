import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  type Allocation,
  type AllocationRule,
  BUCKET_COLORS,
  allocateDeposit,
  allocateMonthly,
  monthKey,
} from "@/lib/buckets";
import { todayIso } from "@/lib/dates";
import { formatCents, parseCents } from "@/lib/money";
import { recordAudit } from "../audit/record";
import type { Database, DbOrTx } from "../db/client";
import { accounts, bucketRules } from "../db/schema";
import { NotFoundError, UserFacingError, pgErrorInfo } from "../errors";
import { accountNetCents } from "../ledger/queries";
import {
  assertDateAllowed,
  createEntry,
  loadBookForPosting,
  validateLines,
} from "../ledger/service";

type Actor = { userId: string };

const centsText = (c: number) => formatCents(c, { showSymbol: false });
const serverToday = () => todayIso(process.env.TZ || undefined);

type AccountRow = typeof accounts.$inferSelect;

async function loadAccount(db: DbOrTx, bookId: string, accountId: string): Promise<AccountRow> {
  if (!z.uuid().safeParse(accountId).success) throw new NotFoundError("That account");
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.bookId, bookId)));
  if (!row) throw new NotFoundError("That account");
  return row;
}

async function bucketsOf(db: DbOrTx, parentId: string) {
  return db
    .select()
    .from(accounts)
    .where(and(eq(accounts.parentAccountId, parentId), eq(accounts.isBucket, true)))
    .orderBy(asc(accounts.sortOrder), asc(accounts.createdAt));
}

/** The Unassigned bucket of a parent, or null if buckets are off. */
export async function unassignedOf(db: DbOrTx, parentId: string): Promise<AccountRow | null> {
  const [row] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.parentAccountId, parentId), eq(accounts.isUnassigned, true)));
  return row ?? null;
}

/**
 * Posts a move between buckets of one real account. Lines: debit each
 * receiving bucket, credit each giving bucket. The real account's total
 * never changes.
 */
async function postBucketMove(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  args: { date: string; memo: string; from: string; moves: { to: string; cents: number }[] },
) {
  const total = args.moves.reduce((n, m) => n + m.cents, 0);
  if (total <= 0) return null;
  const lines = await validateLines(tx, bookId, [
    ...args.moves.map((m) => ({
      accountId: m.to,
      debit: centsText(m.cents),
      credit: "",
      memo: "",
    })),
    { accountId: args.from, debit: "", credit: centsText(total), memo: "" },
  ]);
  return createEntry(tx, {
    actor,
    bookId,
    kind: "bucket",
    entryDate: args.date,
    memo: args.memo,
    lines,
    changeNote: "Created",
  });
}

const nameSchema = z
  .string()
  .trim()
  .min(1, "Give the bucket a name.")
  .max(60, "Keep the name short.");

/**
 * Turns on buckets for an asset account. It gains an Unassigned bucket that
 * takes the account's current balance, and from then on the account itself
 * takes no postings: its balance is the sum of its buckets.
 */
export async function enableBuckets(
  db: Database,
  actor: Actor,
  bookId: string,
  accountId: string,
  raw: { names?: string[] } = {},
) {
  const names = (raw.names ?? []).map((n) => n.trim()).filter(Boolean);
  for (const n of names) nameSchema.parse(n);
  try {
    return await db.transaction(async (tx) => {
      await loadBookForPosting(tx, bookId);
      const parent = await loadAccount(tx, bookId, accountId);
      if (parent.type !== "asset") {
        throw new UserFacingError("Buckets work on asset accounts such as savings or checking.");
      }
      if (parent.bucketsEnabled) throw new UserFacingError(`${parent.name} already has buckets.`);
      if (parent.isBucket || parent.systemRole || parent.archivedAt || !parent.allowsPosting) {
        throw new UserFacingError(`${parent.name} can't hold buckets.`);
      }
      const [child] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(eq(accounts.parentAccountId, parent.id))
        .limit(1);
      if (child) {
        throw new UserFacingError(
          `${parent.name} has sub-accounts. Move them elsewhere before turning on buckets.`,
        );
      }
      const [unassigned] = await tx
        .insert(accounts)
        .values({
          bookId,
          parentAccountId: parent.id,
          name: "Unassigned",
          description: "Deposits wait here until they are moved into a bucket.",
          type: "asset",
          subtype: parent.subtype,
          isSystem: true,
          isBucket: true,
          isUnassigned: true,
          sortOrder: 0,
        })
        .returning();
      const net = await accountNetCents(tx, parent.id);
      if (net !== 0) {
        const today = serverToday();
        const lines = await validateLines(tx, bookId, [
          {
            accountId: unassigned!.id,
            debit: net > 0 ? centsText(net) : "",
            credit: net < 0 ? centsText(-net) : "",
            memo: "",
          },
          {
            accountId: parent.id,
            debit: net < 0 ? centsText(-net) : "",
            credit: net > 0 ? centsText(net) : "",
            memo: "",
          },
        ]);
        await createEntry(tx, {
          actor,
          bookId,
          kind: "bucket",
          entryDate: today,
          memo: `Buckets turned on: ${parent.name} balance moved to Unassigned`,
          lines,
          changeNote: "Created",
        });
      }
      await tx
        .update(accounts)
        .set({ bucketsEnabled: true, allowsPosting: false })
        .where(eq(accounts.id, parent.id));
      for (const [i, name] of names.entries()) {
        await tx.insert(accounts).values({
          bookId,
          parentAccountId: parent.id,
          name,
          type: "asset",
          subtype: parent.subtype,
          isBucket: true,
          color: BUCKET_COLORS[i % BUCKET_COLORS.length],
          sortOrder: i + 1,
        });
      }
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: parent.id,
        action: "update",
        before: { name: parent.name, bucketsEnabled: false },
        after: { name: parent.name, bucketsEnabled: true, movedToUnassignedCents: net },
      });
      return { unassignedId: unassigned!.id, movedCents: net };
    });
  } catch (err) {
    if (err instanceof z.ZodError) throw new UserFacingError(err.issues[0]!.message, "names");
    throw err;
  }
}

const bucketInputSchema = z.object({
  name: nameSchema,
  color: z.enum(BUCKET_COLORS).nullish(),
  goal: z.string().trim().max(30).default(""),
  goalDate: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2})?$/, "Pick a date.")
    .default(""),
});

function parseBucketInput(raw: unknown) {
  const parsed = bucketInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const v = parsed.data;
  let goalCents: number | null = null;
  if (v.goal) {
    try {
      goalCents = parseCents(v.goal);
    } catch {
      throw new UserFacingError("Enter the goal as an amount, like 5,000.", "goal");
    }
    if (goalCents <= 0) throw new UserFacingError("A goal must be above zero.", "goal");
  }
  if (v.goalDate && !goalCents) {
    throw new UserFacingError("Add a goal amount to go with the date.", "goal");
  }
  return { name: v.name, color: v.color ?? null, goalCents, goalDate: v.goalDate || null };
}

function bucketConstraintError(err: unknown): never {
  if (pgErrorInfo(err).constraint === "accounts_sibling_name_key") {
    throw new UserFacingError("There's already a bucket with that name here.", "name");
  }
  throw err;
}

export async function createBucket(
  db: Database,
  actor: Actor,
  bookId: string,
  parentId: string,
  raw: unknown,
) {
  const input = parseBucketInput(raw);
  try {
    return await db.transaction(async (tx) => {
      const parent = await loadAccount(tx, bookId, parentId);
      if (!parent.bucketsEnabled) throw new UserFacingError(`${parent.name} doesn't have buckets.`);
      if (parent.archivedAt) throw new UserFacingError(`${parent.name} is archived.`);
      const existing = await bucketsOf(tx, parent.id);
      const [row] = await tx
        .insert(accounts)
        .values({
          bookId,
          parentAccountId: parent.id,
          name: input.name,
          type: "asset",
          subtype: parent.subtype,
          isBucket: true,
          color: input.color ?? BUCKET_COLORS[existing.length % BUCKET_COLORS.length],
          goalCents: input.goalCents,
          goalDate: input.goalDate,
          sortOrder: existing.length + 1,
        })
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: row!.id,
        action: "create",
        after: row,
      });
      return row!;
    });
  } catch (err) {
    bucketConstraintError(err);
  }
}

export async function updateBucket(
  db: Database,
  actor: Actor,
  bookId: string,
  bucketId: string,
  raw: unknown,
) {
  const input = parseBucketInput(raw);
  try {
    return await db.transaction(async (tx) => {
      const before = await loadAccount(tx, bookId, bucketId);
      if (!before.isBucket) throw new NotFoundError("That bucket");
      const [after] = await tx
        .update(accounts)
        .set({
          // Unassigned keeps its name; it is the app's own bucket.
          name: before.isUnassigned ? before.name : input.name,
          color: input.color ?? before.color,
          goalCents: before.isUnassigned ? null : input.goalCents,
          goalDate: before.isUnassigned ? null : input.goalDate,
        })
        .where(eq(accounts.id, bucketId))
        .returning();
      await recordAudit(tx, {
        bookId,
        userId: actor.userId,
        entityType: "account",
        entityId: bucketId,
        action: "update",
        before,
        after,
      });
      return after!;
    });
  } catch (err) {
    bucketConstraintError(err);
  }
}

const moveSchema = z.object({
  fromId: z.uuid("Pick the bucket to move from."),
  toId: z.uuid("Pick the bucket to move to."),
  amount: z.string().trim().min(1, "Enter an amount."),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date."),
  memo: z.string().trim().max(500).default(""),
});

/** Moves money between two buckets of the same real account. */
export async function moveBetweenBuckets(db: Database, actor: Actor, bookId: string, raw: unknown) {
  const parsed = moveSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;
  let cents: number;
  try {
    cents = parseCents(input.amount);
  } catch {
    throw new UserFacingError("Enter the amount like 250 or 1,250.50.", "amount");
  }
  if (cents <= 0) throw new UserFacingError("Move an amount above zero.", "amount");
  if (input.fromId === input.toId) throw new UserFacingError("Pick two different buckets.", "toId");
  return db.transaction(async (tx) => {
    const book = await loadBookForPosting(tx, bookId);
    assertDateAllowed(input.date, book.startDate);
    const from = await loadAccount(tx, bookId, input.fromId);
    const to = await loadAccount(tx, bookId, input.toId);
    if (!from.isBucket || !to.isBucket || from.parentAccountId !== to.parentAccountId) {
      throw new UserFacingError("Both buckets must be in the same account.", "toId");
    }
    const available = await accountNetCents(tx, from.id);
    if (cents > available) {
      throw new UserFacingError(
        `${from.name} holds ${formatCents(available)}, so it can't give ${formatCents(cents)}.`,
        "amount",
      );
    }
    return postBucketMove(tx, actor, bookId, {
      date: input.date,
      memo: input.memo || `Moved from ${from.name} to ${to.name}`,
      from: from.id,
      moves: [{ to: to.id, cents }],
    });
  });
}

// ---------------------------------------------------------------------------
// Allocation rules
// ---------------------------------------------------------------------------

const ruleSchema = z
  .object({
    bucketAccountId: z.uuid("Pick a bucket."),
    kind: z.enum(["percent", "fixed", "monthly"]),
    amount: z.string().trim().default(""),
    percent: z.string().trim().default(""),
    minDeposit: z.string().trim().default(""),
    enabled: z.boolean().default(true),
  })
  .transform((v, ctx) => {
    const money = (text: string, label: string, path: string) => {
      if (!text) return null;
      try {
        const c = parseCents(text);
        if (c <= 0) throw new Error();
        return c;
      } catch {
        ctx.addIssue({
          code: "custom",
          message: `Enter ${label} like 100 or 100.50.`,
          path: [path],
        });
        return null;
      }
    };
    let percentBp: number | null = null;
    let amountCents: number | null = null;
    if (v.kind === "percent") {
      const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(v.percent.replace(/%$/, "").trim());
      percentBp = m ? Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0")) : null;
      if (!percentBp || percentBp > 10_000) {
        ctx.addIssue({
          code: "custom",
          message: "Enter a percentage from 0.01 to 100.",
          path: ["percent"],
        });
      }
    } else {
      amountCents = money(v.amount, "the amount", "amount");
      if (!amountCents)
        ctx.addIssue({ code: "custom", message: "Enter the amount.", path: ["amount"] });
    }
    return {
      bucketAccountId: v.bucketAccountId,
      kind: v.kind,
      percentBp: v.kind === "percent" ? percentBp : null,
      amountCents: v.kind === "percent" ? null : amountCents,
      minDepositCents:
        v.kind === "monthly" ? null : money(v.minDeposit, "the smallest deposit", "minDeposit"),
      enabled: v.enabled,
    };
  });

function parseRule(raw: unknown) {
  const parsed = ruleSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  return parsed.data;
}

export type BucketRuleRow = typeof bucketRules.$inferSelect;

export async function createBucketRule(
  db: Database,
  actor: Actor,
  bookId: string,
  parentId: string,
  raw: unknown,
) {
  const input = parseRule(raw);
  return db.transaction(async (tx) => {
    const parent = await loadAccount(tx, bookId, parentId);
    const bucket = await loadAccount(tx, bookId, input.bucketAccountId);
    if (!parent.bucketsEnabled || bucket.parentAccountId !== parent.id || bucket.isUnassigned) {
      throw new UserFacingError("Pick one of this account's buckets.", "bucketAccountId");
    }
    const next = await tx.execute<{ p: number }>(
      sql`select coalesce(max(priority), 0) + 1 as p from bucket_rules where parent_account_id = ${parent.id}`,
    );
    const [row] = await tx
      .insert(bucketRules)
      .values({ bookId, parentAccountId: parent.id, priority: Number(next.rows[0]!.p), ...input })
      .returning();
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bucket_rule",
      entityId: row!.id,
      action: "create",
      after: row,
    });
    return row!;
  });
}

async function loadRule(tx: DbOrTx, bookId: string, ruleId: string) {
  if (!z.uuid().safeParse(ruleId).success) throw new NotFoundError("That rule");
  const [row] = await tx
    .select()
    .from(bucketRules)
    .where(and(eq(bucketRules.id, ruleId), eq(bucketRules.bookId, bookId)));
  if (!row) throw new NotFoundError("That rule");
  return row;
}

export async function deleteBucketRule(db: Database, actor: Actor, bookId: string, ruleId: string) {
  return db.transaction(async (tx) => {
    const before = await loadRule(tx, bookId, ruleId);
    await tx.delete(bucketRules).where(eq(bucketRules.id, ruleId));
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bucket_rule",
      entityId: ruleId,
      action: "delete",
      before,
    });
  });
}

export async function moveBucketRule(
  db: Database,
  actor: Actor,
  bookId: string,
  ruleId: string,
  direction: "up" | "down",
) {
  return db.transaction(async (tx) => {
    const rule = await loadRule(tx, bookId, ruleId);
    const rows = await tx
      .select({ id: bucketRules.id })
      .from(bucketRules)
      .where(eq(bucketRules.parentAccountId, rule.parentAccountId))
      .orderBy(asc(bucketRules.priority), asc(bucketRules.createdAt));
    const ids = rows.map((r) => r.id);
    const i = ids.indexOf(ruleId);
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    for (const [index, id] of ids.entries()) {
      await tx
        .update(bucketRules)
        .set({ priority: index + 1 })
        .where(eq(bucketRules.id, id));
    }
    await recordAudit(tx, {
      bookId,
      userId: actor.userId,
      entityType: "bucket_rule",
      entityId: ruleId,
      action: "update",
      after: { moved: direction },
    });
  });
}

const toAllocationRule = (r: BucketRuleRow): AllocationRule => ({
  id: r.id,
  bucketAccountId: r.bucketAccountId,
  kind: r.kind as AllocationRule["kind"],
  amountCents: r.amountCents,
  percentBp: r.percentBp,
  minDepositCents: r.minDepositCents,
  priority: r.priority,
  enabled: r.enabled,
});

async function activeRules(tx: DbOrTx, parentId: string) {
  const rows = await tx
    .select({ rule: bucketRules })
    .from(bucketRules)
    .innerJoin(accounts, eq(accounts.id, bucketRules.bucketAccountId))
    .where(and(eq(bucketRules.parentAccountId, parentId), isNull(accounts.archivedAt)));
  return rows.map((r) => toAllocationRule(r.rule));
}

/**
 * Runs the per-deposit rules for a deposit that just landed in Unassigned.
 * Called inside the approval's transaction, so the deposit and its
 * allocation post together.
 */
export async function allocateDepositInTx(
  tx: DbOrTx,
  actor: Actor,
  bookId: string,
  args: {
    parentId: string;
    unassignedId: string;
    depositCents: number;
    date: string;
    label: string;
  },
): Promise<Allocation[]> {
  const rules = await activeRules(tx, args.parentId);
  const allocations = allocateDeposit(args.depositCents, rules);
  if (allocations.length) {
    await postBucketMove(tx, actor, bookId, {
      date: args.date,
      memo: `Allocated from deposit: ${args.label}`.slice(0, 500),
      from: args.unassignedId,
      moves: allocations.map((a) => ({ to: a.bucketAccountId, cents: a.cents })),
    });
  }
  return allocations;
}

/**
 * Runs monthly rules that haven't run this month, from whatever Unassigned
 * holds. A rule with nothing available waits for the next run; a rule that
 * is partly filled counts as done for the month.
 */
export async function runMonthlyRules(
  db: Database,
  actor: Actor | null,
  options: { bookId?: string; today?: string } = {},
) {
  const today = options.today ?? serverToday();
  const month = monthKey(today);
  const filters = [eq(bucketRules.kind, "monthly"), eq(bucketRules.enabled, true)];
  if (options.bookId) filters.push(eq(bucketRules.bookId, options.bookId));
  const due = await db
    .select()
    .from(bucketRules)
    .where(and(...filters, sql`coalesce(${bucketRules.lastRunMonth}, '') <> ${month}`));
  const parents = [...new Set(due.map((r) => `${r.bookId}|${r.parentAccountId}`))];
  let moved = 0;
  for (const key of parents) {
    const [bookId, parentId] = key.split("|") as [string, string];
    await db.transaction(async (tx) => {
      const book = await loadBookForPosting(tx, bookId).catch(() => null);
      if (!book || today < book.startDate) return;
      const unassigned = await unassignedOf(tx, parentId);
      if (!unassigned) return;
      const available = await accountNetCents(tx, unassigned.id);
      const rules = due.filter((r) => r.parentAccountId === parentId).map(toAllocationRule);
      const allocations = allocateMonthly(available, rules);
      if (allocations.length === 0) return;
      await postBucketMove(tx, actor ?? { userId: null as unknown as string }, bookId, {
        date: today,
        memo: `Monthly allocation, ${month}`,
        from: unassigned.id,
        moves: allocations.map((a) => ({ to: a.bucketAccountId, cents: a.cents })),
      });
      await tx
        .update(bucketRules)
        .set({ lastRunMonth: month })
        .where(
          inArray(
            bucketRules.id,
            allocations.map((a) => a.ruleId),
          ),
        );
      moved += allocations.reduce((n, a) => n + a.cents, 0);
    });
  }
  return { movedCents: moved };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type BucketView = {
  id: string;
  name: string;
  color: string | null;
  isUnassigned: boolean;
  balanceCents: number;
  goalCents: number | null;
  goalDate: string | null;
  archived: boolean;
};

export type BucketAccountView = {
  id: string;
  name: string;
  totalCents: number;
  buckets: BucketView[];
  rules: BucketRuleRow[];
};

export async function bucketOverview(db: DbOrTx, bookId: string) {
  const all = await db.select().from(accounts).where(eq(accounts.bookId, bookId));
  const totals = await db.execute<{ account_id: string; net: string }>(sql`
    select account_id, sum(net_cents)::text as net from ledger_lines
    where book_id = ${bookId} group by account_id
  `);
  const net = new Map(totals.rows.map((r) => [r.account_id, Number(r.net)]));
  const rules = await db
    .select()
    .from(bucketRules)
    .where(eq(bucketRules.bookId, bookId))
    .orderBy(asc(bucketRules.priority));
  const parents = all.filter((a) => a.bucketsEnabled && !a.archivedAt);
  const withBuckets: BucketAccountView[] = parents.map((p) => {
    const buckets = all
      .filter((a) => a.parentAccountId === p.id && a.isBucket)
      .sort((a, b) => Number(b.isUnassigned) - Number(a.isUnassigned) || a.sortOrder - b.sortOrder)
      .map((b) => ({
        id: b.id,
        name: b.name,
        color: b.color,
        isUnassigned: b.isUnassigned,
        balanceCents: net.get(b.id) ?? 0,
        goalCents: b.goalCents,
        goalDate: b.goalDate,
        archived: Boolean(b.archivedAt),
      }));
    return {
      id: p.id,
      name: p.name,
      totalCents: (net.get(p.id) ?? 0) + buckets.reduce((n, b) => n + b.balanceCents, 0),
      buckets,
      rules: rules.filter((r) => r.parentAccountId === p.id),
    };
  });
  const eligible = all
    .filter(
      (a) =>
        a.type === "asset" &&
        !a.bucketsEnabled &&
        !a.isBucket &&
        !a.systemRole &&
        !a.archivedAt &&
        a.allowsPosting &&
        !all.some((c) => c.parentAccountId === a.id),
    )
    .map((a) => ({ id: a.id, name: a.name, subtype: a.subtype, balanceCents: net.get(a.id) ?? 0 }));
  return { accounts: withBuckets, eligible };
}

/** Bucket choices per real account, for the review queue and rules. */
export async function bucketChoices(db: DbOrTx, bookId: string) {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      parentAccountId: accounts.parentAccountId,
      isUnassigned: accounts.isUnassigned,
    })
    .from(accounts)
    .where(
      and(eq(accounts.bookId, bookId), eq(accounts.isBucket, true), isNull(accounts.archivedAt)),
    )
    .orderBy(asc(accounts.sortOrder), asc(accounts.name));
  const out: Record<string, { id: string; name: string; isUnassigned: boolean }[]> = {};
  for (const r of rows) {
    (out[r.parentAccountId!] ??= []).push({ id: r.id, name: r.name, isUnassigned: r.isUnassigned });
  }
  for (const list of Object.values(out)) {
    list.sort((a, b) => Number(b.isUnassigned) - Number(a.isUnassigned));
  }
  return out;
}
