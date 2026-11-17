import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { listEntries } from "@/server/ledger/service";
import { KindBadge } from "./kind-badge";
import { NewEntryShortcut } from "./shortcut";

export const metadata: Metadata = { title: "Journal entries" };

const PAGE_SIZE = 50;

async function JournalContent({ params, searchParams }: PageProps<"/books/[bookId]/journal">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const page = Math.max(1, Number(typeof sp.page === "string" ? sp.page : 1) || 1);
  const { items, total } = await listEntries(getDb(), book.id, {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const canEdit = book.role !== "viewer";
  const base = `/books/${book.id}/journal`;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      {canEdit ? <NewEntryShortcut href={`${base}/new`} /> : null}
      <PageHeader
        title="Journal entries"
        maxWidthClass="max-w-[60rem]"
        description={
          <span className="tabular">{total === 1 ? "1 entry" : `${total} entries`}</span>
        }
        actions={
          canEdit ? (
            <ButtonLink href={`${base}/new`} variant="primary">
              <Plus size={16} aria-hidden />
              New entry
              <kbd className="ml-1 hidden rounded border border-on-signal/30 px-1 font-sans text-[0.6875rem] font-medium leading-4 opacity-80 sm:inline">
                N
              </kbd>
            </ButtonLink>
          ) : null
        }
      />
      <div className="max-w-[60rem] px-5 pb-16 pt-4 lg:px-10">
        {items.length === 0 ? (
          <div className="flex max-w-prose flex-col items-start gap-3 py-10">
            <h2 className="text-lg font-semibold">No entries yet</h2>
            <p className="text-ink-muted">
              A journal entry records money moving between accounts, with debits equal to credits.
              Bank transactions will create entries for you once bank sync arrives; for now you can
              post them by hand, or start with your opening balances.
            </p>
            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <Link href={`${base}/new`} className={buttonClass("primary")}>
                  Post your first entry
                </Link>
              ) : null}
              <Link
                href={`/books/${book.id}/opening-balances`}
                className={buttonClass("secondary")}
              >
                Enter opening balances
              </Link>
            </div>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Date
                </th>
                <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                  No.
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">
                  Entry
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-b border-rule align-top hover:bg-sunken/70">
                  <td className="tabular whitespace-nowrap py-3 pr-3 text-ink-muted">
                    {formatDay(e.entryDate)}
                  </td>
                  <td className="tabular hidden whitespace-nowrap py-3 pr-3 text-ink-muted sm:table-cell">
                    {formatEntryNumber(e.entryNumber)}
                  </td>
                  <td className="min-w-0 py-3 pr-3">
                    <Link href={`${base}/${e.id}`} className="font-medium text-ink hover:underline">
                      {e.memo || e.accountNames.join(", ") || formatEntryNumber(e.entryNumber)}
                    </Link>
                    <KindBadge kind={e.kind} reversed={e.reversed} version={e.currentVersion} />
                    {e.memo ? (
                      <div className="mt-0.5 truncate text-[0.8125rem] text-ink-muted">
                        {e.accountNames.join(", ")}
                      </div>
                    ) : null}
                  </td>
                  <td className="py-3 text-right">
                    <Money cents={e.totalCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 ? (
          <nav aria-label="Pages" className="mt-6 flex items-center gap-3 text-sm">
            {page > 1 ? (
              <Link href={`${base}?page=${page - 1}`} className={buttonClass("secondary", "sm")}>
                Newer
              </Link>
            ) : null}
            <span className="tabular text-ink-muted">
              Page {page} of {pages}
            </span>
            {page < pages ? (
              <Link href={`${base}?page=${page + 1}`} className={buttonClass("secondary", "sm")}>
                Older
              </Link>
            ) : null}
          </nav>
        ) : null}
      </div>
    </>
  );
}

export default function JournalPage(props: PageProps<"/books/[bookId]/journal">) {
  return (
    <Suspense>
      <JournalContent {...props} />
    </Suspense>
  );
}
