"use client";

import {
  BarChart3,
  BookOpenText,
  ChevronRight,
  Gauge,
  CheckCheck,
  HandCoins,
  Link2,
  History,
  Inbox,
  Landmark,
  ListTree,
  NotebookPen,
  PiggyBank,
  Settings2,
  Store,
  Users,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";

const SETUP_KEY = "bb-nav-setup";

export function NavLinks({
  bookId,
  layout,
  reviewCount = 0,
  canEdit = true,
  admin = false,
}: {
  bookId: string;
  layout: "rail" | "bar";
  reviewCount?: number;
  /** Owners and editors also get the book's bank connections. */
  canEdit?: boolean;
  /** Admins also get People in the phone bar. */
  admin?: boolean;
}) {
  const pathname = usePathname();
  type NavLink = { href: string; label: string; Icon: typeof Inbox; count?: number };
  const b = `/books/${bookId}`;
  // Everyday pages first, bookkeeping next, and setup folded away until needed.
  const everyday: NavLink[] = [
    { href: `${b}/review`, label: "For review", Icon: Inbox, count: reviewCount },
    { href: `${b}/accounts`, label: "Chart of accounts", Icon: ListTree },
    { href: `${b}/buckets`, label: "Buckets", Icon: PiggyBank },
    { href: `${b}/budget`, label: "Budget", Icon: Gauge },
    { href: `${b}/reports`, label: "Reports", Icon: BarChart3 },
  ];
  const bookkeeping: NavLink[] = [
    { href: `${b}/journal`, label: "Journal entries", Icon: NotebookPen },
    { href: `${b}/ledger`, label: "General ledger", Icon: BookOpenText },
    { href: `${b}/reconcile`, label: "Reconcile", Icon: CheckCheck },
    { href: `${b}/activity`, label: "Activity", Icon: History },
  ];
  const setup: NavLink[] = [
    ...(canEdit ? [{ href: `${b}/connections`, label: "Bank connections", Icon: Link2 }] : []),
    { href: `${b}/rules`, label: "Rules", Icon: Wand2 },
    { href: `${b}/payees`, label: "Payees", Icon: Store },
    { href: `${b}/loans`, label: "Loans", Icon: HandCoins },
    { href: `${b}/opening-balances`, label: "Opening balances", Icon: Landmark },
    { href: `${b}/settings`, label: "Book settings", Icon: Settings2 },
  ];
  const links = [...everyday, ...bookkeeping, ...setup];
  // The rail has its own admin link at the bottom; the phone bar needs it here.
  const barLinks = admin ? [...links, { href: "/people", label: "People", Icon: Users }] : links;

  if (layout === "bar") {
    return (
      <nav aria-label="Book" className="-my-1.5 flex gap-1 overflow-x-auto py-1.5">
        {barLinks.map(({ href, label, count }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`tap-target-y flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
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
    <nav aria-label="Book" className="flex flex-col gap-5">
      <div className="flex flex-col gap-0.5">{everyday.map(railLink)}</div>
      <div className="flex flex-col gap-0.5">
        <h2 className="px-3 pb-1 text-xs font-medium text-rail-muted">Bookkeeping</h2>
        {bookkeeping.map(railLink)}
      </div>
      <SetupGroup
        active={setup.some((l) => pathname.startsWith(l.href))}
        links={setup.map(railLink)}
      />
    </nav>
  );
}

/**
 * Setup pages fold away: you visit them rarely. The group opens by itself on
 * one of its pages, and otherwise remembers whether you left it open.
 */
function SetupGroup({ active, links }: { active: boolean; links: React.ReactNode[] }) {
  const id = useId();
  const [stored, setStored] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading a per-browser preference after hydration
      setStored(localStorage.getItem(SETUP_KEY) === "open");
    } catch {
      // Storage blocked: start folded.
    }
  }, []);
  const open = active || stored;
  const toggle = () => {
    const next = !open;
    setStored(next);
    try {
      if (next) localStorage.setItem(SETUP_KEY, "open");
      else localStorage.removeItem(SETUP_KEY);
    } catch {
      // Storage blocked: the choice lasts for this page.
    }
  };
  return (
    <div className="flex flex-col">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        disabled={active}
        onClick={toggle}
        className="flex h-7 items-center gap-1 rounded-md px-3 text-left text-xs font-medium text-rail-muted transition-colors duration-150 hover:text-rail-ink disabled:hover:text-rail-muted"
      >
        Setup
        <ChevronRight
          size={13}
          aria-hidden
          className={`transition-[rotate] duration-200 ease-out ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div
        id={id}
        inert={!open}
        className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">{links}</div>
      </div>
    </div>
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
