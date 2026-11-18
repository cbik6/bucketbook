/**
 * Bucket math, kept free of the database so it is easy to test.
 *
 * A real account with buckets turned on is the sum of its buckets. Deposits
 * land in Unassigned; allocation rules then move money into buckets.
 */

export const BUCKET_COLORS = ["green", "blue", "yellow", "pink"] as const;
export type BucketColor = (typeof BUCKET_COLORS)[number];

export type AllocationRule = {
  id: string;
  bucketAccountId: string;
  kind: "percent" | "fixed" | "monthly";
  amountCents: number | null;
  percentBp: number | null;
  minDepositCents: number | null;
  priority: number;
  enabled: boolean;
};

export type Allocation = { ruleId: string; bucketAccountId: string; cents: number };

/**
 * How a deposit is split by the per-deposit rules (percent and fixed), in
 * priority order. Percentages are of the whole deposit, rounded down to the
 * cent; nothing is allocated past what the deposit brought in, and whatever
 * is left stays in Unassigned.
 */
export function allocateDeposit(depositCents: number, rules: AllocationRule[]): Allocation[] {
  if (!Number.isSafeInteger(depositCents) || depositCents <= 0) return [];
  let left = depositCents;
  const out: Allocation[] = [];
  const ordered = rules
    .filter((r) => r.enabled && r.kind !== "monthly")
    .sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (left <= 0) break;
    if (r.minDepositCents && depositCents < r.minDepositCents) continue;
    const want =
      r.kind === "percent"
        ? Math.floor((depositCents * (r.percentBp ?? 0)) / 10_000)
        : (r.amountCents ?? 0);
    const cents = Math.min(want, left);
    if (cents <= 0) continue;
    out.push({ ruleId: r.id, bucketAccountId: r.bucketAccountId, cents });
    left -= cents;
  }
  return out;
}

/**
 * Monthly rules for one parent, given what Unassigned holds now. Each rule
 * takes its amount in priority order until Unassigned runs out; a rule that
 * can only be partly filled takes what is there.
 */
export function allocateMonthly(availableCents: number, rules: AllocationRule[]): Allocation[] {
  let left = Math.max(0, availableCents);
  const out: Allocation[] = [];
  const ordered = rules
    .filter((r) => r.enabled && r.kind === "monthly")
    .sort((a, b) => a.priority - b.priority);
  for (const r of ordered) {
    if (left <= 0) break;
    const cents = Math.min(r.amountCents ?? 0, left);
    if (cents <= 0) continue;
    out.push({ ruleId: r.id, bucketAccountId: r.bucketAccountId, cents });
    left -= cents;
  }
  return out;
}

/** Whole months from `fromDay` up to `toDay`, counting a partial month as one. */
export function monthsUntil(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = fromDay.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = toDay.split("-").map(Number) as [number, number, number];
  let months = (ty - fy) * 12 + (tm - fm);
  if (td > fd) months += 1;
  return Math.max(0, months);
}

export type GoalProgress = {
  /** 0 to 1, for a fill line. */
  fraction: number;
  remainingCents: number;
  /** What to set aside each month to reach the goal by its date. Null without a date. */
  monthlyCents: number | null;
  /** True when the date has passed without reaching the goal. */
  overdue: boolean;
  reached: boolean;
};

export function goalProgress(
  balanceCents: number,
  goalCents: number,
  goalDate: string | null,
  today: string,
): GoalProgress {
  const remaining = Math.max(0, goalCents - balanceCents);
  const reached = remaining === 0;
  const fraction = goalCents > 0 ? Math.min(1, Math.max(0, balanceCents / goalCents)) : 0;
  if (!goalDate || reached) {
    return { fraction, remainingCents: remaining, monthlyCents: null, overdue: false, reached };
  }
  const months = monthsUntil(today, goalDate);
  if (months <= 0) {
    return {
      fraction,
      remainingCents: remaining,
      monthlyCents: remaining,
      overdue: goalDate < today,
      reached,
    };
  }
  return {
    fraction,
    remainingCents: remaining,
    monthlyCents: Math.ceil(remaining / months),
    overdue: false,
    reached,
  };
}

/** "2026-11" for a calendar day. */
export const monthKey = (day: string) => day.slice(0, 7);
