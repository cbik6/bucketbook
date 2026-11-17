import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { CHART_TEMPLATES } from "@/server/accounts/templates";
import { loadBookForPage } from "@/server/guards";
import { ArchiveBookControl, RenameBookForm, StartDateForm } from "./settings-forms";

export const metadata: Metadata = { title: "Book settings" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

async function SettingsContent({ params }: PageProps<"/books/[bookId]/settings">) {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const isOwner = book.role === "owner";

  return (
    <>
      <PageHeader title="Book settings" description={book.name} />
      <div className="flex max-w-3xl flex-col divide-y divide-rule px-5 lg:px-10">
        <section className="py-8" aria-labelledby="name-heading">
          <h2 id="name-heading" className="mb-4 text-base font-semibold">
            Name
          </h2>
          {isOwner ? (
            <RenameBookForm bookId={book.id} name={book.name} />
          ) : (
            <p className="text-ink-muted">Only the book owner can rename it.</p>
          )}
        </section>

        <section className="py-8" aria-labelledby="facts-heading">
          <h2 id="facts-heading" className="mb-4 text-base font-semibold">
            Details
          </h2>
          <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-8 gap-y-2 text-sm">
            <dt className="text-ink-muted">Start date</dt>
            <dd className="tabular">
              {dateFormat.format(new Date(`${book.startDate}T00:00:00Z`))}
            </dd>
            <dt className="text-ink-muted">Currency</dt>
            <dd>{book.currencyCode}</dd>
            <dt className="text-ink-muted">Started from</dt>
            <dd>{CHART_TEMPLATES[book.template as keyof typeof CHART_TEMPLATES]?.label}</dd>
          </dl>
          {isOwner ? (
            <div className="mt-6">
              <StartDateForm bookId={book.id} startDate={book.startDate} />
            </div>
          ) : null}
        </section>

        <section className="py-8" aria-labelledby="archive-heading">
          <h2 id="archive-heading" className="mb-1 text-base font-semibold">
            {book.archivedAt ? "This book is archived" : "Archive this book"}
          </h2>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {book.archivedAt
              ? "It's hidden from the book switcher. Restore it to use it again."
              : "Archiving hides the book from the switcher. Nothing is deleted, and you can restore it anytime from Books."}
          </p>
          {isOwner ? (
            <ArchiveBookControl bookId={book.id} archived={Boolean(book.archivedAt)} />
          ) : null}
        </section>
      </div>
    </>
  );
}

export default function BookSettingsPage(props: PageProps<"/books/[bookId]/settings">) {
  return (
    <Suspense>
      <SettingsContent {...props} />
    </Suspense>
  );
}
