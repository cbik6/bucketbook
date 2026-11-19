import { FileUp, Link2, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { ButtonLink } from "@/components/ui/button";
import type { AccountOptionGroup } from "@/lib/account-options";
import { bankableAccounts } from "@/server/bank/accounts";
import { listAttachments } from "@/server/bank/attachments-service";
import { type QueueTab, listQueue, queueCounts } from "@/server/bank/review-service";
import { bucketChoices } from "@/server/buckets/service";
import { getDb } from "@/server/db/client";
import { loanHints } from "@/server/loans/service";
import { loadBookForPage } from "@/server/guards";
import { entryFormAccounts } from "@/server/ledger/page-data";
import { AccountFilter } from "./account-filter";
import { ReviewQueue, type AttachmentInfo } from "./review-queue";
import { SimpleList } from "./simple-list";

export const metadata: Metadata = { title: "For review" };

const TABS: { id: QueueTab; label: string }[] = [
  { id: "review", label: "For review" },
  { id: "pending", label: "Pending" },
  { id: "posted", label: "Posted" },
  { id: "excluded", label: "Excluded" },
];

async function ReviewContent({ params, searchParams }: PageProps<"/books/[bookId]/review">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { user, book } = await loadBookForPage(bookId);
  const tab = (TABS.find((t) => t.id === sp.tab)?.id ?? "review") as QueueTab;
  const accountFilter = typeof sp.account === "string" ? sp.account : undefined;
  const db = getDb();
  const [counts, items, bankAccounts] = await Promise.all([
    queueCounts(db, book.id),
    listQueue(db, user.id, book.id, tab, { accountId: accountFilter }),
    bankableAccounts(db, book.id),
  ]);
  const canEdit = book.role !== "viewer";
  const base = `/books/${book.id}/review`;

  let body: React.ReactNode;
  if (tab === "review") {
    const groups = await entryFormAccounts(book.id);
    const buckets = await bucketChoices(db, book.id);
    // Account choices for the other book of any transfer between books.
    const partnerGroups: Record<string, AccountOptionGroup[]> = {};
    for (const otherId of new Set(
      items.flatMap((i) =>
        i.transfer && i.transfer.bookId !== book.id ? [i.transfer.bookId] : [],
      ),
    )) {
      partnerGroups[otherId] = await entryFormAccounts(otherId);
    }
    const attachments: Record<string, AttachmentInfo[]> = {};
    for (const i of items.filter((x) => x.attachmentCount > 0)) {
      attachments[i.id] = (await listAttachments(db, book.id, { bankTransactionId: i.id })).map(
        (a) => ({
          id: a.id,
          fileName: a.fileName,
          contentType: a.contentType,
        }),
      );
    }
    body = (
      <ReviewQueue
        bookId={book.id}
        items={items}
        groups={groups}
        partnerGroups={partnerGroups}
        attachments={attachments}
        buckets={buckets}
        ruleOptions={{
          bankAccounts: bankAccounts.map((a) => ({ id: a.id, name: a.name })),
          buckets: bankAccounts.flatMap((a) =>
            (buckets[a.id] ?? []).map((b) => ({ id: b.id, label: `${a.name}: ${b.name}` })),
          ),
        }}
        loans={await loanHints(db, book.id)}
        canEdit={canEdit}
      />
    );
  } else {
    body = <SimpleList bookId={book.id} tab={tab} items={items} canEdit={canEdit} />;
  }

  return (
    <>
      <PageHeader
        title="For review"
        description={
          <span className="hidden sm:inline">
            Bank transactions wait here until you approve them. Nothing reaches the books before
            that.
          </span>
        }
        actions={
          <>
            <span className="hidden gap-2 sm:flex">
              {canEdit ? (
                <ButtonLink href={`/books/${book.id}/connections`} variant="ghost">
                  <Link2 size={15} aria-hidden />
                  Bank connections
                </ButtonLink>
              ) : null}
              <ButtonLink href={`/books/${book.id}/rules`} variant="ghost">
                <Wand2 size={15} aria-hidden />
                Rules
              </ButtonLink>
            </span>
            {canEdit ? (
              <ButtonLink href={`/books/${book.id}/import`} variant="secondary">
                <FileUp size={15} aria-hidden />
                Import
              </ButtonLink>
            ) : null}
          </>
        }
      />
      <div className="px-5 pb-16 pt-4 lg:px-10">
        <div className="flex flex-col gap-3 border-b border-rule sm:flex-row sm:items-end sm:justify-between">
          <nav aria-label="Review tabs" className="-mb-px flex gap-1 overflow-x-auto">
            {TABS.map((t) => {
              const active = t.id === tab;
              const href = t.id === "review" ? base : `${base}?tab=${t.id}`;
              return (
                <Link
                  key={t.id}
                  href={
                    accountFilter
                      ? `${href}${t.id === "review" ? "?" : "&"}account=${accountFilter}`
                      : href
                  }
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors duration-150 ${
                    active
                      ? "border-signal font-medium text-ink"
                      : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {t.label}
                  {t.id !== "posted" && t.id !== "excluded" && counts[t.id] > 0 ? (
                    <span className="tabular rounded-full bg-sunken px-1.5 text-xs leading-5 text-ink-muted">
                      {counts[t.id]}
                    </span>
                  ) : null}
                </Link>
              );
            })}
          </nav>
          {bankAccounts.length > 1 ? (
            <AccountFilter
              base={base}
              tab={tab}
              accounts={bankAccounts.map((a) => ({ id: a.id, name: a.name }))}
              value={accountFilter ?? ""}
            />
          ) : null}
        </div>
        {body}
      </div>
    </>
  );
}

export default function ReviewPage(props: PageProps<"/books/[bookId]/review">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ReviewContent {...props} />
    </Suspense>
  );
}
