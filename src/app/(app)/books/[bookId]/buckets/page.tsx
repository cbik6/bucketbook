import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { bucketOverview } from "@/server/buckets/service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { BucketsBoard } from "./buckets-board";

export const metadata: Metadata = { title: "Buckets" };

async function BucketsContent({ params }: PageProps<"/books/[bookId]/buckets">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const overview = await bucketOverview(getDb(), book.id);
  return (
    <>
      <PageHeader
        title="Buckets"
        maxWidthClass="max-w-[72rem]"
        description="Split one real account into goals. The account always equals the sum of its buckets; your bank only sees the total."
      />
      <div className="box-content max-w-[72rem] px-5 pb-16 pt-6 lg:px-10">
        <BucketsBoard
          bookId={book.id}
          accounts={overview.accounts}
          eligible={overview.eligible}
          today={serverToday()}
          minDate={book.startDate}
          canEdit={book.role !== "viewer"}
        />
      </div>
    </>
  );
}

export default function BucketsPage(props: PageProps<"/books/[bookId]/buckets">) {
  return (
    <Suspense>
      <BucketsContent {...props} />
    </Suspense>
  );
}
