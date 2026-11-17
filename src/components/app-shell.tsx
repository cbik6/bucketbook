import { LogOut } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOutAction } from "@/app/(auth)/login/actions";
import { CHART_TEMPLATES } from "@/server/accounts/templates";
import type { CurrentUser } from "@/server/auth/session";
import type { BookWithRole } from "@/server/books/service";
import { BookSwitcher, type SwitcherBook } from "./book-switcher";
import { NavLinks } from "./nav-links";
import { ThemeToggle } from "./theme-toggle";
import { Wordmark } from "./wordmark";

function toSwitcher(books: BookWithRole[]): SwitcherBook[] {
  return books.map((b) => ({
    id: b.id,
    name: b.name,
    templateLabel: CHART_TEMPLATES[b.template as keyof typeof CHART_TEMPLATES]?.label ?? "Book",
  }));
}

function SignOutButton({ compact }: { compact?: boolean }) {
  return (
    <form action={signOutAction}>
      <button
        type="submit"
        aria-label="Sign out"
        title="Sign out"
        className="flex h-8 items-center gap-2 rounded-lg px-2 text-sm text-rail-muted transition-colors duration-150 hover:bg-rail-raised hover:text-rail-ink"
      >
        <LogOut size={15} strokeWidth={1.75} aria-hidden />
        {compact ? null : <span>Sign out</span>}
      </button>
    </form>
  );
}

/**
 * The app frame: a spruce rail on wide screens, a spruce top bar on phones.
 * The page content sits on paper beside it.
 */
export function AppShell({
  user,
  books,
  currentBookId,
  children,
}: {
  user: CurrentUser;
  books: BookWithRole[];
  currentBookId?: string;
  children: ReactNode;
}) {
  const switcherBooks = toSwitcher(books);
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr] lg:bg-[linear-gradient(to_right,var(--rail)_16rem,transparent_16rem)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-signal px-3 py-2 text-on-signal focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>

      {/* Wide screens: rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 bg-rail px-3 pb-4 pt-5 text-rail-ink lg:flex">
        <Link href="/" className="rounded-md px-2 outline-offset-4">
          <Wordmark />
        </Link>
        <BookSwitcher books={switcherBooks} currentId={currentBookId} />
        {currentBookId ? <NavLinks bookId={currentBookId} layout="rail" /> : null}
        <div className="mt-auto flex flex-col gap-3 border-t border-rail-rule px-1 pt-4">
          <div className="min-w-0 px-1">
            <div className="truncate text-sm font-medium">{user.name}</div>
            <div className="truncate text-xs text-rail-muted">{user.email}</div>
          </div>
          <div className="flex items-center justify-between">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </aside>

      {/* Phones and tablets: top bar */}
      <header className="bg-rail pt-[env(safe-area-inset-top)] text-rail-ink lg:hidden">
        <div className="flex h-14 items-center gap-3 px-4">
          <Link href="/" className="rounded-md" aria-label="Home">
            <Wordmark />
          </Link>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton compact />
          </div>
        </div>
        <div className="flex flex-col gap-2 px-4 pb-3">
          <BookSwitcher books={switcherBooks} currentId={currentBookId} />
          {currentBookId ? <NavLinks bookId={currentBookId} layout="bar" /> : null}
        </div>
      </header>

      <main id="main" className="min-w-0 pb-[env(safe-area-inset-bottom)]">
        {children}
      </main>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-rule px-5 pb-5 pt-6 sm:flex-row sm:items-end sm:justify-between lg:px-10 lg:pt-10">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function AppShellFallback() {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr] lg:bg-[linear-gradient(to_right,var(--rail)_16rem,transparent_16rem)]">
      <aside className="hidden h-dvh bg-rail lg:block" />
      <header className="h-28 bg-rail lg:hidden" />
      <div className="px-5 pt-10 lg:px-10">
        <div className="h-7 w-56 animate-pulse rounded bg-rule" />
      </div>
    </div>
  );
}
