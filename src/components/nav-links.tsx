"use client";

import { ListTree, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLinks({ bookId, layout }: { bookId: string; layout: "rail" | "bar" }) {
  const pathname = usePathname();
  const links = [
    { href: `/books/${bookId}/accounts`, label: "Chart of accounts", Icon: ListTree },
    { href: `/books/${bookId}/settings`, label: "Book settings", Icon: Settings2 },
  ];

  if (layout === "bar") {
    return (
      <nav aria-label="Book" className="flex gap-1 overflow-x-auto">
        {links.map(({ href, label }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors duration-150 ${
                active ? "bg-rail-active text-rail-ink" : "text-rail-muted hover:text-rail-ink"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav aria-label="Book" className="flex flex-col gap-0.5">
      {links.map(({ href, label, Icon }) => {
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
          </Link>
        );
      })}
    </nav>
  );
}
