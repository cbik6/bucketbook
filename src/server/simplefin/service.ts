import { randomInt } from "node:crypto";
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { todayIso } from "@/lib/dates";
import { recordAudit } from "../audit/record";
import { applyRules } from "../bank/rules-service";
import { requireBankableAccount } from "../bank/accounts";
import { requireBookAccess } from "../books/service";
import { decryptSecret, encryptSecret } from "../crypto/secret-box";
import type { Database, DbOrTx } from "../db/client";
import { uuidArray } from "../db/sql";
import {
  accounts,
  bankFeeds,
  bankTransactions,
  bookMembers,
  books,
  simplefinConnections,
  simplefinRequests,
} from "../db/schema";
import { getEnv } from "../env";
import { NotFoundError, UserFacingError, pgErrorInfo } from "../errors";
import { type ExistingRow, addDays, planFeedSync, syncWindows, incomingDay } from "./plan";
import {
  type AccountSet,
  DAILY_REQUEST_BUDGET,
  type FetchLike,
  MAX_WINDOW_DAYS,
  OVERLAP_DAYS,
  claimSetupToken,
  fetchAccountSet,
  looksLikeAccessUrl,
  redactSecrets,
} from "./protocol";

type Actor = { userId: string };

/** Most windows one sync will fetch; a longer backfill continues next time. */
export const MAX_WINDOWS_PER_SYNC = 8;

const serverTimeZone = () => process.env.TZ || undefined;

function encryptionKey() {
  return getEnv().APP_ENCRYPTION_KEY;
}

async function logRequest(
  db: DbOrTx,
  connectionId: string,
  values: {
    windowStart?: string;
    windowEnd?: string;
    ok: boolean;
    newCount?: number;
    updatedCount?: number;
  },
) {
  await db.insert(simplefinRequests).values({ connectionId, ...values });
}

export async function requestsInLastDay(db: DbOrTx, connectionId: string): Promise<number> {
  const result = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from simplefin_requests
    where connection_id = ${connectionId} and requested_at > now() - interval '24 hours'
  `);
  return Number(result.rows[0]?.n ?? 0);
}

/** Creates or refreshes the feed rows for the accounts SimpleFIN reports. */
async function upsertFeeds(
  db: DbOrTx,
  connectionId: string,
  set: AccountSet,
  updateBalances: boolean,
) {
  for (const a of set.accounts) {
    const values = {
      connectionId,
      externalId: a.id,
      name: a.name,
      institution: a.institution,
      currency: a.currency,
      balanceCents: a.balanceCents,
      availableBalanceCents: a.availableBalanceCents,
      balanceAt: new Date(a.balanceEpoch * 1000),
    };
    await db
      .insert(bankFeeds)
      .values(values)
      .onConflictDoUpdate({
        target: [bankFeeds.connectionId, bankFeeds.externalId],
        set: updateBalances
          ? {
              name: values.name,
              institution: values.institution,
              currency: values.currency,
              balanceCents: values.balanceCents,
              availableBalanceCents: values.availableBalanceCents,
              balanceAt: values.balanceAt,
            }
          : { name: values.name, institution: values.institution },
      });
  }
}

/**
 * Connects SimpleFIN from a Setup Token (claimed once) or, for the demo and
 * for moving installs, a full Access URL. The Access URL is encrypted before
 * it is stored and never leaves the server.
 */
export async function connectSimplefin(
  db: Database,
  actor: Actor,
  tokenOrUrl: string,
  fetchImpl: FetchLike = fetch,
) {
  const text = tokenOrUrl.trim();
  if (!text) throw new UserFacingError("Paste your SimpleFIN setup token.", "token");
  const accessUrl = looksLikeAccessUrl(text) ? text : await claimSetupToken(text, fetchImpl);
  const set = await fetchAccountSet(accessUrl, null, fetchImpl);
  const label = set.accounts.find((a) => a.institution)?.institution ?? "SimpleFIN";
  return db.transaction(async (tx) => {
    const [conn] = await tx
      .insert(simplefinConnections)
      .values({
        label,
        accessUrlCiphertext: encryptSecret(accessUrl, encryptionKey()),
        createdBy: actor.userId,
        syncHour: 6,
        syncMinute: randomInt(0, 60),
        lastSyncAt: new Date(),
        lastSyncStatus: set.messages.length ? "warning" : "ok",
        lastSyncMessages: set.messages.slice(0, 20),
      })
      .returning();
    await logRequest(tx, conn!.id, { ok: true });
    await upsertFeeds(tx, conn!.id, set, true);
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "simplefin_connection",
      entityId: conn!.id,
      action: "create",
      after: { label, accounts: set.accounts.length },
    });
    return { connection: conn!, accountCount: set.accounts.length, messages: set.messages };
  });
}

async function loadConnection(db: DbOrTx, userId: string, connectionId: string) {
  if (!z.uuid().safeParse(connectionId).success) throw new NotFoundError("That connection");
  const [conn] = await db
    .select()
    .from(simplefinConnections)
    .where(
      and(
        eq(simplefinConnections.id, connectionId),
        or(eq(simplefinConnections.createdBy, userId), isNull(simplefinConnections.createdBy)),
      ),
    );
  if (!conn) throw new NotFoundError("That connection");
  return conn;
}

export type FeedView = {
  id: string;
  name: string;
  institution: string | null;
  currency: string;
  ignored: boolean;
  bookId: string | null;
  bookName: string | null;
  accountId: string | null;
  accountName: string | null;
  balanceCents: number | null;
  balanceAt: Date | null;
  syncedFrom: string | null;
  syncedThrough: string | null;
  /** Books balance of the mapped account (debits minus credits). */
  ledgerCents: number | null;
  /** Total still waiting in For review on that account. */
  reviewCents: number;
  reviewCount: number;
  pendingCount: number;
  /** Bank balance minus books minus review: what nothing explains yet. */
  unexplainedCents: number | null;
  /** True when the mapped book starts before everything fetched so far. */
  backfilling: boolean;
};

export type ConnectionView = {
  id: string;
  label: string;
  syncHour: number;
  syncMinute: number;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncMessages: string[];
  syncing: boolean;
  requestsToday: number;
  feeds: FeedView[];
};

export async function listConnections(db: DbOrTx, userId: string): Promise<ConnectionView[]> {
  const conns = await db
    .select()
    .from(simplefinConnections)
    .where(or(eq(simplefinConnections.createdBy, userId), isNull(simplefinConnections.createdBy)))
    .orderBy(asc(simplefinConnections.createdAt));
  if (conns.length === 0) return [];
  const feeds = await db
    .select({
      feed: bankFeeds,
      bookName: books.name,
      bookStart: books.startDate,
      accountName: accounts.name,
    })
    .from(bankFeeds)
    .leftJoin(books, eq(books.id, bankFeeds.bookId))
    .leftJoin(accounts, eq(accounts.id, bankFeeds.accountId))
    .where(
      inArray(
        bankFeeds.connectionId,
        conns.map((c) => c.id),
      ),
    )
    .orderBy(asc(bankFeeds.institution), asc(bankFeeds.name));
  const accountIds = feeds.map((f) => f.feed.accountId).filter((v): v is string => Boolean(v));
  const ledger = new Map<string, number>();
  const review = new Map<string, { cents: number; n: number; pending: number }>();
  if (accountIds.length) {
    const l = await db.execute<{ account_id: string; net: string }>(sql`
      select account_id, sum(net_cents)::text as net from ledger_lines
      where account_id = any(${uuidArray(accountIds)}) group by account_id
    `);
    for (const r of l.rows) ledger.set(r.account_id, Number(r.net));
    const q = await db.execute<{
      account_id: string;
      cents: string;
      n: number;
      pending: number;
    }>(sql`
      select account_id,
             coalesce(sum(amount_cents) filter (where status = 'review'), 0)::text as cents,
             count(*) filter (where status = 'review')::int as n,
             count(*) filter (where status = 'pending')::int as pending
      from bank_transactions where account_id = any(${uuidArray(accountIds)}) group by account_id
    `);
    for (const r of q.rows) {
      review.set(r.account_id, {
        cents: Number(r.cents),
        n: Number(r.n),
        pending: Number(r.pending),
      });
    }
  }
  const counts = new Map<string, number>();
  for (const c of conns) counts.set(c.id, await requestsInLastDay(db, c.id));
  return conns.map((c) => ({
    id: c.id,
    label: c.label,
    syncHour: c.syncHour,
    syncMinute: c.syncMinute,
    lastSyncAt: c.lastSyncAt,
    lastSyncStatus: c.lastSyncStatus,
    lastSyncMessages: c.lastSyncMessages ?? [],
    syncing: Boolean(c.syncStartedAt && Date.now() - c.syncStartedAt.getTime() < 10 * 60_000),
    requestsToday: counts.get(c.id) ?? 0,
    feeds: feeds
      .filter((f) => f.feed.connectionId === c.id)
      .map(({ feed, bookName, bookStart, accountName }) => {
        const ledgerCents = feed.accountId ? (ledger.get(feed.accountId) ?? 0) : null;
        const r = feed.accountId ? review.get(feed.accountId) : undefined;
        const reviewCents = r?.cents ?? 0;
        return {
          id: feed.id,
          name: feed.name,
          institution: feed.institution,
          currency: feed.currency,
          ignored: feed.ignored,
          bookId: feed.bookId,
          bookName: bookName ?? null,
          accountId: feed.accountId,
          accountName: accountName ?? null,
          balanceCents: feed.balanceCents,
          balanceAt: feed.balanceAt,
          syncedFrom: feed.syncedFrom,
          syncedThrough: feed.syncedThrough,
          ledgerCents,
          reviewCents,
          reviewCount: r?.n ?? 0,
          pendingCount: r?.pending ?? 0,
          unexplainedCents:
            ledgerCents !== null && feed.balanceCents !== null && feed.syncedThrough
              ? feed.balanceCents - ledgerCents - reviewCents
              : null,
          backfilling: Boolean(
            feed.accountId && bookStart && (!feed.syncedFrom || feed.syncedFrom > bookStart),
          ),
        };
      }),
  }));
}

const mappingSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("map"),
    bookId: z.uuid("Pick a book."),
    accountId: z.uuid("Pick an account."),
  }),
  z.object({ mode: z.literal("ignore") }),
  z.object({ mode: z.literal("unmap") }),
]);

/**
 * Points a SimpleFIN account at an account in a book (or ignores it). A new
 * mapping starts its history from the book's start date on the next sync.
 */
export async function mapFeed(db: Database, actor: Actor, feedId: string, raw: unknown) {
  const parsed = mappingSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new UserFacingError(issue.message, String(issue.path[0] ?? ""));
  }
  const input = parsed.data;
  if (!z.uuid().safeParse(feedId).success) throw new NotFoundError("That bank account");
  const [feed] = await db.select().from(bankFeeds).where(eq(bankFeeds.id, feedId));
  if (!feed) throw new NotFoundError("That bank account");
  await loadConnection(db, actor.userId, feed.connectionId);
  if (input.mode === "map") {
    await requireBookAccess(db, actor.userId, input.bookId, "editor");
    await requireBankableAccount(db, input.bookId, input.accountId);
  }
  try {
    return await db.transaction(async (tx) => {
      const sameTarget = input.mode === "map" && feed.accountId === input.accountId;
      const [after] = await tx
        .update(bankFeeds)
        .set(
          input.mode === "map"
            ? {
                bookId: input.bookId,
                accountId: input.accountId,
                ignored: false,
                ...(sameTarget ? {} : { syncedFrom: null, syncedThrough: null }),
              }
            : {
                bookId: null,
                accountId: null,
                ignored: input.mode === "ignore",
                syncedFrom: null,
                syncedThrough: null,
              },
        )
        .where(eq(bankFeeds.id, feedId))
        .returning();
      await recordAudit(tx, {
        bookId: input.mode === "map" ? input.bookId : feed.bookId,
        userId: actor.userId,
        entityType: "bank_feed",
        entityId: feedId,
        action: "update",
        before: { bookId: feed.bookId, accountId: feed.accountId, ignored: feed.ignored },
        after: { bookId: after!.bookId, accountId: after!.accountId, ignored: after!.ignored },
      });
      return after!;
    });
  } catch (err) {
    if (pgErrorInfo(err).constraint === "bank_feeds_account_key") {
      throw new UserFacingError(
        "Another bank account already feeds that account. Each account takes one feed.",
        "accountId",
      );
    }
    throw err;
  }
}

export async function setSyncTime(db: Database, actor: Actor, connectionId: string, hour: number) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new UserFacingError("Pick an hour.", "syncHour");
  }
  await loadConnection(db, actor.userId, connectionId);
  const [after] = await db
    .update(simplefinConnections)
    .set({ syncHour: hour })
    .where(eq(simplefinConnections.id, connectionId))
    .returning();
  return after!;
}

/** Removes the connection and its stored Access URL. Transactions already imported stay. */
export async function disconnectSimplefin(db: Database, actor: Actor, connectionId: string) {
  const conn = await loadConnection(db, actor.userId, connectionId);
  await db.transaction(async (tx) => {
    await tx.delete(simplefinConnections).where(eq(simplefinConnections.id, connectionId));
    await recordAudit(tx, {
      userId: actor.userId,
      entityType: "simplefin_connection",
      entityId: connectionId,
      action: "delete",
      before: { label: conn.label },
    });
  });
}

export type SyncResult = {
  status: "ok" | "warning" | "error";
  messages: string[];
  newCount: number;
  updatedCount: number;
  requests: number;
  /** True when a long backfill still has older windows to fetch. */
  moreToFetch: boolean;
};

type Interval = { from: string; to: string };

function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.from < i.to).sort((a, b) => a.from.localeCompare(b.from));
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.from <= last.to) last.to = i.to > last.to ? i.to : last.to;
    else out.push({ ...i });
  }
  return out;
}

/**
 * Fetches new and changed transactions for every mapped account on one
 * connection. Recent days come first, then (if a book starts earlier than
 * what has been fetched) older history in 45-day windows. Stays within the
 * bridge's daily request budget.
 */
export async function runSync(
  db: Database,
  connectionId: string,
  options: { trigger: "manual" | "schedule"; userId?: string; fetchImpl?: FetchLike; now?: Date },
): Promise<SyncResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? new Date();
  const conn = options.userId
    ? await loadConnection(db, options.userId, connectionId)
    : (
        await db
          .select()
          .from(simplefinConnections)
          .where(eq(simplefinConnections.id, connectionId))
      )[0];
  if (!conn) throw new NotFoundError("That connection");

  // Claim the connection so two syncs never run at once.
  const claimed = await db
    .update(simplefinConnections)
    .set({ syncStartedAt: now })
    .where(
      and(
        eq(simplefinConnections.id, connectionId),
        or(
          isNull(simplefinConnections.syncStartedAt),
          sql`${simplefinConnections.syncStartedAt} < now() - interval '10 minutes'`,
        ),
      ),
    )
    .returning({ id: simplefinConnections.id });
  if (claimed.length === 0) {
    throw new UserFacingError("A sync is already running for this connection.");
  }

  const result: SyncResult = {
    status: "ok",
    messages: [],
    newCount: 0,
    updatedCount: 0,
    requests: 0,
    moreToFetch: false,
  };
  try {
    const used = await requestsInLastDay(db, connectionId);
    let budget = DAILY_REQUEST_BUDGET - used;
    if (budget <= 0) {
      throw new UserFacingError(
        `SimpleFIN asks apps to stay around 24 requests a day, and this connection has made ${used} in the last 24 hours. Bucketbook will try again at the next scheduled sync.`,
      );
    }
    const accessUrl = decryptSecret(conn.accessUrlCiphertext, encryptionKey());
    const today = todayIso(serverTimeZone(), now);
    const end = addDays(today, 1);

    const feeds = await db
      .select({ feed: bankFeeds, startDate: books.startDate, archived: books.archivedAt })
      .from(bankFeeds)
      .innerJoin(books, eq(books.id, bankFeeds.bookId))
      .where(
        and(
          eq(bankFeeds.connectionId, connectionId),
          isNotNull(bankFeeds.accountId),
          eq(bankFeeds.ignored, false),
        ),
      );
    const active = feeds.filter((f) => !f.archived);

    if (active.length === 0) {
      // Nothing mapped yet: just refresh the account list and balances.
      const set = await fetchAccountSet(accessUrl, null, fetchImpl);
      result.requests += 1;
      await logRequest(db, connectionId, { ok: true });
      await upsertFeeds(db, connectionId, set, true);
      result.messages.push(...set.messages);
    } else {
      const oldestPending = await db
        .select({
          feedId: bankTransactions.feedId,
          day: sql<string>`min(${bankTransactions.postedDate})::text`,
        })
        .from(bankTransactions)
        .where(
          and(
            inArray(
              bankTransactions.feedId,
              active.map((f) => f.feed.id),
            ),
            eq(bankTransactions.status, "pending"),
          ),
        )
        .groupBy(bankTransactions.feedId);
      const pendingFrom = new Map(oldestPending.map((r) => [r.feedId, r.day]));
      const needed: Interval[] = [];
      for (const { feed, startDate } of active) {
        if (!feed.syncedThrough || !feed.syncedFrom) {
          needed.push({ from: startDate, to: end });
          continue;
        }
        let recent = addDays(feed.syncedThrough, -OVERLAP_DAYS);
        const p = pendingFrom.get(feed.id);
        if (p && p < recent) recent = p;
        needed.push({ from: recent < startDate ? startDate : recent, to: end });
        if (feed.syncedFrom > startDate) needed.push({ from: startDate, to: feed.syncedFrom });
      }
      const windows = mergeIntervals(needed)
        .reverse()
        .flatMap((i) => syncWindows(i.from, i.to, MAX_WINDOW_DAYS));
      const limit = Math.min(MAX_WINDOWS_PER_SYNC, budget);
      result.moreToFetch = windows.length > limit;

      for (const [index, w] of windows.slice(0, limit).entries()) {
        const set = await fetchAccountSet(accessUrl, w, fetchImpl);
        result.requests += 1;
        budget -= 1;
        // Balances come from the newest window only.
        await upsertFeeds(db, connectionId, set, index === 0);
        result.messages.push(...set.messages);
        let windowNew = 0;
        let windowUpdated = 0;
        for (const { feed, startDate } of active) {
          const account = set.accounts.find((a) => a.id === feed.externalId);
          if (!account) continue;
          const counts = await applyWindow(db, feed, startDate, account.transactions, w, now);
          windowNew += counts.newCount;
          windowUpdated += counts.updatedCount;
          result.messages.push(...counts.warnings);
          await extendCoverage(db, feed.id, w);
        }
        result.newCount += windowNew;
        result.updatedCount += windowUpdated;
        await logRequest(db, connectionId, {
          windowStart: w.startDay,
          windowEnd: w.endDay,
          ok: true,
          newCount: windowNew,
          updatedCount: windowUpdated,
        });
      }
      if (result.moreToFetch) {
        result.messages.push(
          "Older history is still being fetched a few windows at a time to stay within SimpleFIN's limits. It continues at the next sync.",
        );
      }
    }
    result.messages = [...new Set(result.messages)].slice(0, 20);
    result.status = result.messages.length > 0 ? "warning" : "ok";
  } catch (err) {
    result.status = "error";
    if (err instanceof UserFacingError) {
      result.messages = [err.message];
    } else {
      // Log the cause only: a failed query's text carries transaction details.
      const e = err as Error & { cause?: Error };
      const detail =
        e?.cause?.message ??
        String(e?.message ?? err)
          .split("\n")[0]!
          .slice(0, 200);
      console.error("[simplefin] sync failed:", redactSecrets(detail));
      result.messages = ["The sync failed unexpectedly. Check the server logs and try again."];
    }
    if (result.requests === 0) await logRequest(db, connectionId, { ok: false }).catch(() => {});
  } finally {
    await db
      .update(simplefinConnections)
      .set({
        syncStartedAt: null,
        lastSyncAt: now,
        lastSyncStatus: result.status,
        lastSyncMessages: result.messages,
      })
      .where(eq(simplefinConnections.id, connectionId));
  }
  return result;
}

async function extendCoverage(db: DbOrTx, feedId: string, w: { startDay: string; endDay: string }) {
  // Windows arrive newest first and touch each other, so coverage grows as one range.
  await db.execute(sql`
    update bank_feeds set
      synced_from = case
        when synced_from is null or ${w.startDay}::date < synced_from then ${w.startDay}::date
        else synced_from end,
      synced_through = case
        when synced_through is null or ${w.endDay}::date > synced_through then ${w.endDay}::date
        else synced_through end
    where id = ${feedId}
      and (synced_from is null or ${w.endDay}::date >= synced_from)
  `);
}

type FeedRow = typeof bankFeeds.$inferSelect;

async function applyWindow(
  db: Database,
  feed: FeedRow,
  bookStartDate: string,
  transactions: AccountSet["accounts"][number]["transactions"],
  w: { startDay: string; endDay: string },
  now: Date,
) {
  const incoming = transactions.map((t) => ({ ...t, day: incomingDay(t, now, serverTimeZone()) }));
  const ids = incoming.map((t) => t.id);
  const padFrom = addDays(w.startDay, -10);
  const padTo = addDays(w.endDay, 10);
  return db.transaction(async (tx) => {
    const columns = {
      id: bankTransactions.id,
      externalId: bankTransactions.externalId,
      feedId: bankTransactions.feedId,
      status: bankTransactions.status,
      amountCents: bankTransactions.amountCents,
      postedDate: bankTransactions.postedDate,
      description: bankTransactions.description,
    };
    const existing = (await tx
      .select(columns)
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.feedId, feed.id),
          or(
            ids.length ? inArray(bankTransactions.externalId, ids) : sql`false`,
            and(
              gte(bankTransactions.postedDate, padFrom),
              sql`${bankTransactions.postedDate} < ${padTo}`,
            ),
            eq(bankTransactions.status, "pending"),
          ),
        ),
      )) as ExistingRow[];
    const others = (await tx
      .select(columns)
      .from(bankTransactions)
      .where(
        and(
          eq(bankTransactions.accountId, feed.accountId!),
          or(isNull(bankTransactions.feedId), ne(bankTransactions.feedId, feed.id)),
          gte(bankTransactions.postedDate, padFrom),
          sql`${bankTransactions.postedDate} < ${padTo}`,
        ),
      )) as ExistingRow[];
    const plan = planFeedSync({
      feedId: feed.id,
      feedName: feed.name,
      existing,
      others,
      incoming,
      windowStart: w.startDay,
      windowEnd: w.endDay,
      bookStartDate,
    });
    const touched: string[] = [];
    if (plan.inserts.length) {
      const rows = await tx
        .insert(bankTransactions)
        .values(
          plan.inserts.map((i) => ({
            bookId: feed.bookId!,
            accountId: feed.accountId!,
            feedId: feed.id,
            source: "simplefin",
            externalId: i.tx.id,
            postedDate: i.tx.day,
            transactedDate: i.tx.transactedEpoch
              ? incomingDay({ ...i.tx, pending: true, postedEpoch: 0 }, now, serverTimeZone())
              : null,
            amountCents: i.tx.amountCents,
            description: i.tx.description,
            payee: i.tx.payee,
            bankMemo: i.tx.memo,
            status: i.status,
            duplicateOfId: i.duplicateOfId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: bankTransactions.id });
      touched.push(...rows.map((r) => r.id));
    }
    for (const u of plan.updates) {
      await tx
        .update(bankTransactions)
        .set({
          status: u.status,
          postedDate: u.tx.day,
          amountCents: u.tx.amountCents,
          description: u.tx.description,
          payee: u.tx.payee,
          bankMemo: u.tx.memo,
        })
        .where(eq(bankTransactions.id, u.id));
      if (u.enteredReview) touched.push(u.id);
    }
    if (plan.removals.length) {
      await tx
        .update(bankTransactions)
        .set({ status: "removed" })
        .where(inArray(bankTransactions.id, plan.removals));
    }
    await applyRules(tx, feed.bookId!, touched);
    return {
      newCount: plan.inserts.length,
      updatedCount: plan.updates.length,
      warnings: plan.warnings,
    };
  });
}

/** Connections whose daily sync is due, for the job scheduler. */
export async function allConnectionSchedules(db: DbOrTx) {
  return db
    .select({
      id: simplefinConnections.id,
      syncHour: simplefinConnections.syncHour,
      syncMinute: simplefinConnections.syncMinute,
    })
    .from(simplefinConnections);
}

/** True when the user has at least one book they can edit (needed to map accounts). */
export async function editableBooks(db: DbOrTx, userId: string) {
  return db
    .select({ id: books.id, name: books.name })
    .from(books)
    .innerJoin(bookMembers, and(eq(bookMembers.bookId, books.id), eq(bookMembers.userId, userId)))
    .where(and(isNull(books.archivedAt), ne(bookMembers.role, "viewer")))
    .orderBy(asc(books.createdAt));
}
