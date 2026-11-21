/**
 * Transfer matching: money leaving one of your accounts and arriving in
 * another shows up twice, once on each side. Two transactions are a likely
 * transfer when they are on different accounts, the amounts are equal and
 * opposite, and the dates are at most a few days apart. This covers credit
 * card payments, checking to savings, and transfers between books.
 *
 * One side may still be pending at its bank (a card payment usually shows on
 * the card as pending for a day or two after it leaves checking). That side
 * can't be approved yet, but it still tells the other side where the money
 * went, so a pending item pairs with an item in review in the same book.
 */

export const TRANSFER_WINDOW_DAYS = 4;

export type MatchItem = {
  id: string;
  bookId: string;
  accountId: string;
  amountCents: number;
  postedDate: string;
  /** Still pending at the bank: it can pair, but only with a reviewable item in its own book. */
  pending?: boolean;
};

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

export function isTransferPair(a: MatchItem, b: MatchItem, windowDays = TRANSFER_WINDOW_DAYS) {
  return (
    a.id !== b.id &&
    a.accountId !== b.accountId &&
    a.amountCents === -b.amountCents &&
    a.amountCents !== 0 &&
    !(a.pending && b.pending) &&
    (!(a.pending || b.pending) || a.bookId === b.bookId) &&
    Math.abs(dayNumber(a.postedDate) - dayNumber(b.postedDate)) <= windowDays
  );
}

/**
 * Pairs items one to one. Closest dates pair first; ties go to a partner that
 * has cleared, then to the same book (an ordinary transfer is likelier than
 * one between books), then to the earlier id for a stable result. Returns a map from each paired id to its
 * partner.
 */
export function pairTransfers(
  items: MatchItem[],
  windowDays = TRANSFER_WINDOW_DAYS,
): Map<string, MatchItem> {
  const byAmount = new Map<number, MatchItem[]>();
  for (const it of items) {
    const list = byAmount.get(it.amountCents) ?? [];
    list.push(it);
    byAmount.set(it.amountCents, list);
  }
  const candidates: Array<{
    a: MatchItem;
    b: MatchItem;
    gap: number;
    pending: number;
    crossBook: number;
  }> = [];
  for (const a of items) {
    if (a.amountCents >= 0) continue; // look from the outflow side only, once per pair
    for (const b of byAmount.get(-a.amountCents) ?? []) {
      if (!isTransferPair(a, b, windowDays)) continue;
      candidates.push({
        a,
        b,
        gap: Math.abs(dayNumber(a.postedDate) - dayNumber(b.postedDate)),
        pending: a.pending || b.pending ? 1 : 0,
        crossBook: a.bookId === b.bookId ? 0 : 1,
      });
    }
  }
  candidates.sort(
    (x, y) =>
      x.gap - y.gap ||
      x.pending - y.pending ||
      x.crossBook - y.crossBook ||
      x.a.id.localeCompare(y.a.id) ||
      x.b.id.localeCompare(y.b.id),
  );
  const out = new Map<string, MatchItem>();
  for (const c of candidates) {
    if (out.has(c.a.id) || out.has(c.b.id)) continue;
    out.set(c.a.id, c.b);
    out.set(c.b.id, c.a);
  }
  return out;
}
