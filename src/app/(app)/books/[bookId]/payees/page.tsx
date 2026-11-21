import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { entryFormAccounts } from "@/server/ledger/page-data";
import { listPayees } from "@/server/payees/service";
import { PayeesManager } from "./payees-manager";

export const metadata: Metadata = { title: "Payees" };

async function PayeesContent({ params }: PageProps<"/books/[bookId]/payees">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const [payees, groups] = await Promise.all([
    listPayees(getDb(), book.id),
    entryFormAccounts(book.id),
  ]);
  return (
    <>
      <PageHeader
        title="Payees"
        maxWidthClass="max-w-[60rem]"
        description="Who your money goes to and comes from. A payee's usual category is suggested in For review, and the bank text it was added under is recognized next time. Renaming or merging a payee updates every entry that uses it."
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <PayeesManager
          bookId={book.id}
          payees={payees}
          groups={groups}
          canEdit={book.role !== "viewer"}
        />
      </div>
    </>
  );
}

export default function PayeesPage(props: PageProps<"/books/[bookId]/payees">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <PayeesContent {...props} />
    </Suspense>
  );
}
