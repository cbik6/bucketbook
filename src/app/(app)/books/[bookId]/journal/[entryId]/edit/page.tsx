import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { formatEntryNumber } from "@/lib/ledger-math";
import { formatCents } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadBookForPage } from "@/server/guards";
import { entryFormAccounts, serverToday } from "@/server/ledger/page-data";
import { getEntryDetail } from "@/server/ledger/service";
import { reconciledStatements } from "@/server/reconcile/service";
import { formatDay } from "@/lib/dates";
import { saveEntryAction } from "../../actions";
import { EntryForm } from "../../entry-form";

export const metadata: Metadata = { title: "Edit journal entry" };

const plain = (c: number) => (c ? formatCents(c, { showSymbol: false }) : "");

async function EditContent({ params }: PageProps<"/books/[bookId]/journal/[entryId]/edit">) {
  await connection();
  const { bookId, entryId } = await params;
  const { book } = await loadBookForPage(bookId, "editor");
  const detail = await getEntryDetail(getDb(), book.id, entryId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const detailHref = `/books/${book.id}/journal/${entryId}`;
  if (detail.entry.kind === "opening_balance") redirect(`/books/${book.id}/opening-balances`);
  if (detail.entry.kind === "reversal" || detail.reversedBy) redirect(detailHref);

  const statements = await reconciledStatements(getDb(), entryId);
  const reconciledNote = statements[0]
    ? `This entry was reconciled on the ${statements[0].accountName} statement ending ${formatDay(statements[0].statementDate)}.`
    : undefined;
  const groups = await entryFormAccounts(
    book.id,
    detail.lines.map((l) => l.accountId),
  );
  return (
    <>
      <PageHeader
        title={`Edit ${formatEntryNumber(detail.entry.entryNumber)}`}
        maxWidthClass="max-w-[60rem]"
        description={
          detail.entry.kind === "bank"
            ? "Saving keeps the current version in the entry's history. The bank account line must still match the bank."
            : "Saving keeps the current version in the entry's history."
        }
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <EntryForm
          mode="edit"
          action={saveEntryAction.bind(null, book.id, entryId)}
          groups={groups}
          defaultDate={serverToday()}
          minDate={book.startDate}
          cancelHref={detailHref}
          reconciledNote={reconciledNote}
          initial={{
            entryDate: detail.entry.entryDate,
            payee: detail.entry.payee,
            memo: detail.entry.memo,
            lines: detail.lines.map((l) => ({
              accountId: l.accountId,
              debit: plain(l.debitCents),
              credit: plain(l.creditCents),
              memo: l.memo ?? "",
            })),
          }}
        />
      </div>
    </>
  );
}

export default function EditEntryPage(props: PageProps<"/books/[bookId]/journal/[entryId]/edit">) {
  return (
    <Suspense>
      <EditContent {...props} />
    </Suspense>
  );
}
