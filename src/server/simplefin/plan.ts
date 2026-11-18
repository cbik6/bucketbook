import type { BankTxStatus } from "../db/schema";
import { type SimplefinTransaction, epochToDay } from "./protocol";

/**
 * Decides what one sync response means for one feed, without touching the
 * database, so the rules are easy to test:
 *
 * 1. Match by SimpleFIN transaction id first.
 * 2. A pending charge is shown but never posted. When it clears with the same
 *    id it moves to For review (amount and date updated, for example a tip).
 * 3. A pending charge the bank stops reporting was dropped or replaced by a
 *    posted one with a new id, so it is marked removed.
 * 4. A new posted transaction that looks like one already on the account
 *    (same amount, a few days apart, different id) is flagged as a possible
 *    duplicate. You confirm before anything is skipped.
 */

export const DUPLICATE_WINDOW_DAYS = 3;

export type ExistingRow = {
  id: string;
  externalId: string;
  feedId: string | null;
  status: BankTxStatus;
  amountCents: number;
  postedDate: string;
  description: string;
};

export type IncomingTx = SimplefinTransaction & { day: string };

export type PlannedInsert = {
  tx: IncomingTx;
  status: "pending" | "review";
  duplicateOfId: string | null;
};

export type PlannedUpdate = {
  id: string;
  tx: IncomingTx;
  status: BankTxStatus;
  /** True when it just left pending (or came back), so rules should run. */
  enteredReview: boolean;
};

export type FeedPlan = {
  inserts: PlannedInsert[];
  updates: PlannedUpdate[];
  removals: string[];
  skippedBeforeStart: number;
  warnings: string[];
};

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

export function incomingDay(tx: SimplefinTransaction, now: Date, timeZone?: string): string {
  if (!tx.pending && tx.postedEpoch > 0) return epochToDay(tx.postedEpoch, timeZone);
  if (tx.transactedEpoch) return epochToDay(tx.transactedEpoch, timeZone);
  return epochToDay(Math.floor(now.getTime() / 1000), timeZone);
}

function changed(row: ExistingRow, tx: IncomingTx): boolean {
  return (
    row.amountCents !== tx.amountCents ||
    row.postedDate !== tx.day ||
    row.description !== tx.description
  );
}

export function planFeedSync(args: {
  feedId: string;
  feedName: string;
  /** Rows already stored for this feed. */
  existing: ExistingRow[];
  /** Other rows on the same ledger account (CSV imports, other feeds), for duplicate checks. */
  others: ExistingRow[];
  incoming: IncomingTx[];
  /** The window this response covered, [start, end). */
  windowStart: string;
  windowEnd: string;
  bookStartDate: string;
}): FeedPlan {
  const plan: FeedPlan = {
    inserts: [],
    updates: [],
    removals: [],
    skippedBeforeStart: 0,
    warnings: [],
  };
  const byExternal = new Map(args.existing.map((r) => [r.externalId, r]));
  const seen = new Set<string>();
  const freshPosted: IncomingTx[] = [];

  for (const tx of args.incoming) {
    if (seen.has(tx.id)) continue;
    seen.add(tx.id);
    if (tx.day < args.bookStartDate) {
      plan.skippedBeforeStart += 1;
      continue;
    }
    const row = byExternal.get(tx.id);
    if (!row) {
      if (tx.pending) plan.inserts.push({ tx, status: "pending", duplicateOfId: null });
      else freshPosted.push(tx);
      continue;
    }
    switch (row.status) {
      case "pending":
        if (!tx.pending) {
          plan.updates.push({ id: row.id, tx, status: "review", enteredReview: true });
        } else if (changed(row, tx)) {
          plan.updates.push({ id: row.id, tx, status: "pending", enteredReview: false });
        }
        break;
      case "review":
        // Never move back to pending; just keep the details current.
        if (changed(row, tx)) {
          plan.updates.push({ id: row.id, tx, status: "review", enteredReview: false });
        }
        break;
      case "removed": {
        const status = tx.pending ? "pending" : "review";
        plan.updates.push({ id: row.id, tx, status, enteredReview: status === "review" });
        break;
      }
      case "posted":
        if (row.amountCents !== tx.amountCents) {
          plan.warnings.push(
            `${args.feedName}: the bank changed the amount of "${tx.description}" on ${tx.day} after it was posted. Check that entry.`,
          );
        }
        break;
      case "excluded":
        break;
    }
  }

  // Pending charges the bank no longer reports were dropped or replaced.
  for (const row of args.existing) {
    if (
      row.status === "pending" &&
      !seen.has(row.externalId) &&
      row.postedDate >= args.windowStart &&
      row.postedDate < args.windowEnd
    ) {
      plan.removals.push(row.id);
    }
  }

  // Possible duplicates: same account, same amount, a few days apart, different id.
  const candidates = [...args.existing, ...args.others].filter(
    (r) =>
      (r.status === "review" || r.status === "posted") &&
      !(r.feedId === args.feedId && seen.has(r.externalId)),
  );
  const claimed = new Set<string>();
  for (const tx of freshPosted) {
    let best: ExistingRow | null = null;
    let bestGap = Infinity;
    for (const r of candidates) {
      if (claimed.has(r.id) || r.amountCents !== tx.amountCents) continue;
      const gap = Math.abs(dayNumber(r.postedDate) - dayNumber(tx.day));
      if (gap <= DUPLICATE_WINDOW_DAYS && gap < bestGap) {
        best = r;
        bestGap = gap;
      }
    }
    if (best) claimed.add(best.id);
    plan.inserts.push({ tx, status: "review", duplicateOfId: best?.id ?? null });
  }
  return plan;
}

/**
 * Splits [from, to) into windows of at most `maxDays`, newest first, so the
 * recent days arrive first and a long backfill can stop part way.
 */
export function syncWindows(
  from: string,
  to: string,
  maxDays: number,
): Array<{ startDay: string; endDay: string }> {
  const out: Array<{ startDay: string; endDay: string }> = [];
  let end = dayNumber(to);
  const start = dayNumber(from);
  while (end > start) {
    const s = Math.max(start, end - maxDays);
    out.push({ startDay: dayFromNumber(s), endDay: dayFromNumber(end) });
    end = s;
  }
  return out;
}

export function dayFromNumber(n: number): string {
  return new Date(n * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return dayFromNumber(dayNumber(day) + days);
}

export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}
