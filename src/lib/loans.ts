/**
 * Loan math in integer cents. Interest for a month is the balance times the
 * annual rate over 12, rounded half up to the cent; the payment is the
 * standard level payment rounded to the cent, and the last payment pays off
 * whatever is left, the way lenders' schedules do.
 *
 * Rates are stored in millionths: 6.5% is 65000.
 */

export const RATE_SCALE = 1_000_000;

/** Parses "6.5", "6.125%" or "0" into millionths. Up to four decimal places. */
export function parseRate(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(text.trim().replace(/%$/, "").trim());
  if (!m) return null;
  const micro = Number(m[1]) * 10_000 + Number((m[2] ?? "").padEnd(4, "0"));
  return micro <= RATE_SCALE ? micro : null;
}

export function formatRate(micro: number): string {
  const whole = Math.floor(micro / 10_000);
  const frac = String(micro % 10_000)
    .padStart(4, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}%` : `${whole}%`;
}

/** One month of interest on a balance, rounded half up to the cent. */
export function monthlyInterest(balanceCents: number, rateMicro: number): number {
  if (balanceCents <= 0 || rateMicro <= 0) return 0;
  const denom = BigInt(12 * RATE_SCALE);
  const num = BigInt(balanceCents) * BigInt(rateMicro);
  const two = BigInt(2);
  return Number((num * two + denom) / (denom * two));
}

/** The level monthly payment, rounded to the cent. */
export function levelPayment(principalCents: number, rateMicro: number, months: number): number {
  if (months <= 0) throw new Error("A loan needs at least one payment.");
  if (rateMicro === 0) return Math.ceil(principalCents / months);
  const r = rateMicro / RATE_SCALE / 12;
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -months));
  return Math.round(payment);
}

export type ScheduleRow = {
  number: number;
  date: string;
  paymentCents: number;
  interestCents: number;
  principalCents: number;
  balanceCents: number;
};

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

export function amortize(args: {
  principalCents: number;
  rateMicro: number;
  months: number;
  paymentCents: number;
  firstPaymentDate: string;
}): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let balance = args.principalCents;
  for (let n = 1; n <= args.months && balance > 0; n++) {
    const interest = monthlyInterest(balance, args.rateMicro);
    let principal = args.paymentCents - interest;
    if (principal <= 0 && n < args.months) {
      throw new Error(
        "The payment doesn't cover the interest, so the loan would never be paid off.",
      );
    }
    if (n === args.months || principal > balance) principal = balance;
    balance -= principal;
    rows.push({
      number: n,
      date: addMonths(args.firstPaymentDate, n - 1),
      paymentCents: principal + interest,
      interestCents: interest,
      principalCents: principal,
      balanceCents: balance,
    });
  }
  return rows;
}

/**
 * Splits an actual payment into interest (one month on what is owed now) and
 * principal (the rest). A payment smaller than the interest is all interest.
 */
export function splitPayment(
  paymentCents: number,
  owedCents: number,
  rateMicro: number,
): { interestCents: number; principalCents: number } {
  const interest = Math.min(paymentCents, monthlyInterest(owedCents, rateMicro));
  return { interestCents: interest, principalCents: paymentCents - interest };
}
