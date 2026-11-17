import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AppShell, AppShellFallback, PageHeader } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import { CHART_TEMPLATES } from "@/server/accounts/templates";
import { requireUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";

export const metadata: Metadata = { title: "Books" };

const dateFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

async function BooksContent() {
  const user = await requireUser();
  const all = await listBooksForUser(getDb(), user.id, { includeArchived: true });
  const active = all.filter((b) => !b.archivedAt);
  const archived = all.filter((b) => b.archivedAt);

  return (
    <AppShell user={user} books={active}>
      <PageHeader
        title="Books"
        description="Each book keeps its own accounts and reports."
        actions={
          <ButtonLink href="/books/new" variant="primary">
            <Plus size={16} aria-hidden />
            New book
          </ButtonLink>
        }
      />
      <div className="px-5 py-6 lg:px-10">
        {active.length === 0 ? (
          <p className="max-w-prose text-ink-muted">
            No open books. Create one to get started, or restore an archived book below.
          </p>
        ) : null}
        <BookTable books={active} />
        {archived.length > 0 ? (
          <>
            <h2 className="mb-3 mt-10 text-sm font-semibold text-ink-muted">Archived</h2>
            <BookTable books={archived} muted />
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

function BookTable({
  books,
  muted,
}: {
  books: Awaited<ReturnType<typeof listBooksForUser>>;
  muted?: boolean;
}) {
  if (books.length === 0) return null;
  return (
    <table className="w-full max-w-3xl text-sm">
      <thead>
        <tr className="border-b border-rule text-left text-xs text-ink-muted">
          <th scope="col" className="py-2 pr-4 font-medium">
            Name
          </th>
          <th scope="col" className="py-2 pr-4 font-medium">
            Started from
          </th>
          <th scope="col" className="py-2 text-right font-medium">
            Start date
          </th>
        </tr>
      </thead>
      <tbody>
        {books.map((b) => (
          <tr key={b.id} className="border-b border-rule">
            <td className="py-3 pr-4">
              <Link
                href={`/books/${b.id}/accounts`}
                className={`font-medium hover:underline ${muted ? "text-ink-muted" : "text-ink"}`}
              >
                {b.name}
              </Link>
            </td>
            <td className="py-3 pr-4 text-ink-muted">
              {CHART_TEMPLATES[b.template as keyof typeof CHART_TEMPLATES]?.label}
            </td>
            <td className="tabular py-3 text-right text-ink-muted">
              {dateFormat.format(new Date(`${b.startDate}T00:00:00Z`))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function BooksPage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <BooksContent />
    </Suspense>
  );
}
