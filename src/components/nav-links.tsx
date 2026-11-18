"use client";

import {
  BarChart3,
  BookOpenText,
  Gauge,
  CheckCheck,
  HandCoins,
  History,
  Inbox,
  Landmark,
  ListTree,
  NotebookPen,
  PiggyBank,
  Settings2,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({
  bookId,
  layout,
  reviewCount = 0,
}: {
  bookId: string;
  layout: "rail" | "bar";
  reviewCount?: number;
}) {
  const pathname = usePathname();
  const links: Array<{ href: string; label: string; Icon: typeof Inbox; count?: number }> = [
    { href: `/books/${bookId}/review`, label: "For review", Icon: Inbox, count: reviewCount },
    { href: `/books/${bookId}/buckets`, label: "Buckets", Icon: PiggyBank },
    { href: `/books/${bookId}/accounts`, label: "Chart of accounts", Icon: ListTree },
    { href: `/books/${bookId}/journal`, label: "Journal entries", Icon: NotebookPen },
    { href: `/books/${bookId}/ledger`, label: "General ledger", Icon: BookOpenText },
    { href: `/books/${bookId}/reports`, label: "Reports", Icon: BarChart3 },
    { href: `/books/${bookId}/budget`, label: "Budget", Icon: Gauge },
    { href: `/books/${bookId}/reconcile`, label: "Reconcile", Icon: CheckCheck },
    { href: `/books/${bookId}/loans`, label: "Loans", Icon: HandCoins },
    { href: `/books/${bookId}/rules`, label: "Rules", Icon: Wand2 },
    { href: `/books/${bookId}/opening-balances`, label: "Opening balances", Icon: Landmark },
    { href: `/books/${bookId}/activity`, label: "Activity", Icon: History },
    { href: `/books/${bookId}/settings`, label: "Book settings", Icon: Settings2 },
  ];
  // The rail has its own Bank connections link at the bottom; the phone bar needs one here.
  const barLinks = [
    ...links,
    { href: `/connections?book=${bookId}`, label: "Bank connections", Icon: Inbox },
  ];

  if (layout === "bar") {
    return (
      <nav aria-label="Book" className="flex gap-1 overflow-x-auto">
        {barLinks.map(({ href, label, count }) => {
          const active = pathname.startsWith(href.split("?")[0]!);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
                active ? "bg-rail-active text-rail-ink" : "text-rail-muted hover:text-rail-ink"
              }`}
            >
              {label}
              <CountBadge count={count} />
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Book" className="flex flex-col gap-0.5">
      {links.map(({ href, label, Icon, count }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`relative flex h-9 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-150 ${
              active
                ? "bg-rail-active font-medium text-rail-ink"
                : "text-rail-muted hover:bg-rail-raised hover:text-rail-ink"
            }`}
          >
            {active ? (
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--rail-focus)]"
              />
            ) : null}
            <Icon size={16} strokeWidth={1.75} aria-hidden />
            {label}
            <span className="ml-auto">
              <CountBadge count={count} />
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

/** How many transactions wait in review. Hidden at zero; read as "12 waiting". */
function CountBadge({ count }: { count?: number }) {
  if (!count) return null;
  return (
    <span className="tabular rounded-full bg-[var(--rail-focus)] px-1.5 text-[0.75rem] font-semibold leading-5 text-[var(--on-rail-focus)]">
      {count > 999 ? "999+" : count}
      <span className="sr-only"> waiting</span>
    </span>
  );
}
