import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { accountPath } from "@/lib/account-tree";
import { listAccounts } from "@/server/accounts/service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { listLoans } from "@/server/loans/service";
import { LoansManager } from "./loans-manager";

export const metadata: Metadata = { title: "Loans" };

async function LoansContent({ params }: PageProps<"/books/[bookId]/loans">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const db = getDb();
  const [loans, rows] = await Promise.all([listLoans(db, book.id), listAccounts(db, book.id)]);
  const pick = (type: string) =>
    rows
      .filter((a) => a.type === type && a.allowsPosting && !a.archivedAt && !a.systemRole)
      .map((a) => ({ id: a.id, label: accountPath(rows, a.id).join(": "), subtype: a.subtype }));
  return (
    <>
      <PageHeader
        title="Loans"
        maxWidthClass="max-w-[60rem]"
        description="Set up a loan once; each payment you approve in For review is split into principal and interest for you."
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <LoansManager
          bookId={book.id}
          loans={loans}
          liabilities={pick("liability")}
          expenses={pick("expense")}
          today={serverToday()}
          canEdit={book.role !== "viewer"}
        />
      </div>
    </>
  );
}

export default function LoansPage(props: PageProps<"/books/[bookId]/loans">) {
  return (
    <Suspense>
      <LoansContent {...props} />
    </Suspense>
  );
}
