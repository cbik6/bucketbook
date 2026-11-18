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
  type NavLink = { href: string; label: string; Icon: typeof Inbox; count?: number };
  const b = `/books/${bookId}`;
  // Grouped by how often you reach for them.
  const groups: Array<{ label: string; links: NavLink[] }> = [
    {
      label: "Every week",
      links: [
        { href: `${b}/review`, label: "For review", Icon: Inbox, count: reviewCount },
        { href: `${b}/buckets`, label: "Buckets", Icon: PiggyBank },
        { href: `${b}/budget`, label: "Budget", Icon: Gauge },
        { href: `${b}/reports`, label: "Reports", Icon: BarChart3 },
      ],
    },
    {
      label: "Books",
      links: [
        { href: `${b}/journal`, label: "Journal entries", Icon: NotebookPen },
        { href: `${b}/ledger`, label: "General ledger", Icon: BookOpenText },
        { href: `${b}/accounts`, label: "Chart of accounts", Icon: ListTree },
        { href: `${b}/reconcile`, label: "Reconcile", Icon: CheckCheck },
      ],
    },
    {
      label: "Setup",
      links: [
        { href: `${b}/loans`, label: "Loans", Icon: HandCoins },
        { href: `${b}/rules`, label: "Rules", Icon: Wand2 },
        { href: `${b}/opening-balances`, label: "Opening balances", Icon: Landmark },
        { href: `${b}/activity`, label: "Activity", Icon: History },
        { href: `${b}/settings`, label: "Book settings", Icon: Settings2 },
      ],
    },
  ];
  const links = groups.flatMap((g) => g.links);
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

  const railLink = ({ href, label, Icon, count }: NavLink) => {
    const active = pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`relative flex h-8 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors duration-150 ${
          active
            ? "bg-rail-active font-medium text-rail-ink"
            : "text-rail-muted hover:bg-rail-raised hover:text-rail-ink"
        }`}
      >
        {active ? (
          <span
            aria-hidden
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--rail-focus)]"
          />
        ) : null}
        <Icon size={16} strokeWidth={1.75} aria-hidden />
        {label}
        <span className="ml-auto">
          <CountBadge count={count} />
        </span>
      </Link>
    );
  };

  return (
    <nav aria-label="Book" className="flex flex-col gap-4">
      {groups.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <h2 className="px-3 pb-1 text-xs font-medium text-rail-muted">{g.label}</h2>
          {g.links.map(railLink)}
        </div>
      ))}
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
