import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { loadBookForPage } from "@/server/guards";
import { entryFormAccounts, serverToday } from "@/server/ledger/page-data";
import { saveEntryAction } from "../actions";
import { EntryForm } from "../entry-form";

export const metadata: Metadata = { title: "New journal entry" };

async function NewEntryContent({ params, searchParams }: PageProps<"/books/[bookId]/journal/new">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId, "editor");
  const groups = await entryFormAccounts(book.id);
  const today = serverToday();
  const posted = typeof sp.posted === "string" ? sp.posted : undefined;

  return (
    <>
      <PageHeader title="New journal entry" maxWidthClass="max-w-[60rem]" />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        {posted ? (
          <p role="status" className="mb-5 rounded-xl bg-signal-soft px-4 py-3 text-sm">
            Entry posted.{" "}
            <Link
              href={`/books/${book.id}/journal/${posted}`}
              className="font-medium text-signal-ink underline"
            >
              View it
            </Link>
          </p>
        ) : null}
        <EntryForm
          key={posted ?? "new"}
          mode="new"
          action={saveEntryAction.bind(null, book.id, null)}
          groups={groups}
          defaultDate={today < book.startDate ? book.startDate : today}
          minDate={book.startDate}
          cancelHref={`/books/${book.id}/journal`}
        />
      </div>
    </>
  );
}

export default function NewEntryPage(props: PageProps<"/books/[bookId]/journal/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewEntryContent {...props} />
    </Suspense>
  );
}
