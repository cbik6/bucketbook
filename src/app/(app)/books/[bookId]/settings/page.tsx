import { connection } from "next/server";
import type { Metadata } from "next";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { BackupStatusPanel } from "@/components/backup-status";
import { backupHealth } from "@/server/backup-status";
import { APP_NAME, APP_VERSION, CHANGELOG_URL } from "@/lib/app-config";
import { CHART_TEMPLATES } from "@/server/accounts/templates";
import { loadBookForPage } from "@/server/guards";
import { getDb } from "@/server/db/client";
import { bookHasConnection } from "@/server/simplefin/service";
import {
  ArchiveBookControl,
  BankSyncForm,
  DeleteBookControl,
  RenameBookForm,
} from "./settings-forms";

export const metadata: Metadata = { title: "Book settings" };

const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" });

async function SettingsContent({ params }: PageProps<"/books/[bookId]/settings">) {
  // Per-user page: always render at request time, never at build time.
  await connection();
  const { bookId } = await params;
  const { user, book } = await loadBookForPage(bookId);
  const isOwner = book.role === "owner";
  const timeZone = process.env.TZ || "UTC";
  const connections = await bookHasConnection(getDb(), book.id);
  const backups = user.isAdmin ? await backupHealth() : null;

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
            <dt className="text-ink-muted">{APP_NAME} version</dt>
            <dd>
              <span className="tabular">{APP_VERSION}</span>{" "}
              <a
                href={CHANGELOG_URL}
                target="_blank"
                rel="noreferrer"
                className="text-signal-ink underline underline-offset-2"
              >
                What&apos;s new
              </a>
            </dd>
          </dl>
          <p className="mt-4 text-[0.8125rem] text-ink-muted">
            The start date is fixed once the book is created: opening balances are as of that day.
          </p>
        </section>

        <section className="py-8" aria-labelledby="bank-sync-heading">
          <h2 id="bank-sync-heading" className="mb-1 scroll-mt-20 text-base font-semibold">
            Bank sync
          </h2>
          <p className="mb-4 max-w-prose text-sm text-ink-muted">
            {connections
              ? "How often Bucketbook asks SimpleFIN for new transactions from this book's banks."
              : "How often Bucketbook will ask SimpleFIN for new transactions once a bank is connected to this book."}{" "}
            Banks usually send SimpleFIN new transactions about once a day, so syncing more often
            mostly finds them sooner. SimpleFIN allows about 24 requests a day.
          </p>
          <BankSyncForm
            bookId={book.id}
            everyHours={book.bankSyncEveryHours}
            hour={book.bankSyncHour}
            timeZone={timeZone}
            canEdit={isOwner}
          />
        </section>

        {backups ? (
          <section className="py-8" aria-labelledby="backups-heading">
            <h2 id="backups-heading" className="mb-1 scroll-mt-20 text-base font-semibold">
              Backups
            </h2>
            <p className="mb-4 max-w-prose text-sm text-ink-muted">
              A copy of the whole install&apos;s database (every book), made on the server. Only
              admins see this.
            </p>
            <BackupStatusPanel health={backups} timeZone={timeZone} />
          </section>
        ) : null}

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

        {book.archivedAt && isOwner ? (
          <section className="py-8" aria-labelledby="delete-heading">
            <h2 id="delete-heading" className="mb-1 text-base font-semibold">
              Delete this book
            </h2>
            <p className="mb-4 max-w-prose text-sm text-ink-muted">
              Permanently erases the book and everything in it: entries, accounts, buckets, rules,
              reconciliations, and receipts. This can&apos;t be undone, so export any reports you
              want to keep first. Bank accounts linked to it stay connected and wait to be set up
              again.
            </p>
            <DeleteBookControl bookId={book.id} name={book.name} />
          </section>
        ) : null}
      </div>
    </>
  );
}

export default function BookSettingsPage(props: PageProps<"/books/[bookId]/settings">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <SettingsContent {...props} />
    </Suspense>
  );
}
