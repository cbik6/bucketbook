import Link from "next/link";
import { Money } from "@/components/money";
import type { BankAccountCard } from "@/server/bank/accounts";

/**
 * A card per bank account across the top, each with the bank's balance and the
 * books' balance side by side. Picking a card shows only that account.
 */
export function AccountCards({
  cards,
  base,
  tab,
  value,
  timeZone,
}: {
  cards: BankAccountCard[];
  base: string;
  tab: string;
  value: string;
  timeZone: string;
}) {
  if (cards.length === 0) return null;
  const href = (account: string) => {
    const params = new URLSearchParams();
    if (tab !== "review") params.set("tab", tab);
    if (account) params.set("account", account);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  };
  const asOf = (d: Date) =>
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(new Date(d));
  const total = cards.reduce((n, c) => n + c.reviewCount, 0);

  return (
    <nav aria-label="Bank accounts" className="-mx-5 overflow-x-auto px-5 pb-1 lg:-mx-10 lg:px-10">
      <div className="flex gap-3">
        {cards.length > 1 ? (
          <div className="shrink-0">
            <Card href={href("")} active={!value}>
              <span className="text-sm font-semibold text-ink">All accounts</span>
              <Waiting count={total} />
              <span className="mt-auto text-[0.8125rem] text-ink-muted">
                {cards.length} accounts
              </span>
            </Card>
          </div>
        ) : null}
        {cards.map((c) => (
          <div key={c.id} className="shrink-0">
            <Card href={href(c.id)} active={value === c.id || cards.length === 1}>
              <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
              <Waiting count={c.reviewCount} />
              <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[0.8125rem]">
                <dt className="text-ink-muted">Bank balance</dt>
                <dd className="text-right" title={c.bankAt ? `As of ${asOf(c.bankAt)}` : undefined}>
                  {c.bankCents === null ? (
                    <span className="text-ink-faint">{"\u2014"}</span>
                  ) : (
                    <Money cents={c.bankCents} className="font-medium text-ink" />
                  )}
                </dd>
                <dt className="text-ink-muted">In Bucketbook</dt>
                <dd className="text-right">
                  <Money cents={c.bookCents} className="text-ink" />
                </dd>
              </dl>
            </Card>
          </div>
        ))}
      </div>
    </nav>
  );
}

function Card({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      replace
      aria-current={active ? "page" : undefined}
      className={`relative flex h-[7.25rem] w-60 flex-col gap-1 overflow-hidden rounded-xl border bg-surface p-3.5 transition-[border-color,box-shadow] duration-150 ${
        active
          ? "border-signal shadow-[inset_0_-3px_0_var(--signal)]"
          : "border-rule hover:border-rule-strong"
      }`}
    >
      {children}
    </Link>
  );
}

function Waiting({ count }: { count: number }) {
  return count > 0 ? (
    <span className="tabular text-[0.8125rem] font-medium text-signal-ink">{count} to review</span>
  ) : (
    <span className="text-[0.8125rem] text-ink-muted">Nothing to review</span>
  );
}
