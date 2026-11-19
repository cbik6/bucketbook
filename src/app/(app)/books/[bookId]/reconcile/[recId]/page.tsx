import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { formatDay } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { NotFoundError } from "@/server/errors";
import { loadBookForPage } from "@/server/guards";
import { listReconciliations, reconciliationState } from "@/server/reconcile/service";
import { RecWorkspace } from "./rec-workspace";

export const metadata: Metadata = { title: "Reconciliation" };

async function RecContent({ params }: PageProps<"/books/[bookId]/reconcile/[recId]">) {
  await connection();
  const { bookId, recId } = await params;
  const { book } = await loadBookForPage(bookId);
  const state = await reconciliationState(getDb(), book.id, recId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const all = await listReconciliations(getDb(), book.id);
  const latestFinished = all.find(
    (r) => r.rec.accountId === state.rec.accountId && r.rec.status === "finished",
  );
  const finished = state.rec.status === "finished";
  return (
    <>
      <PageHeader
        title={`${finished ? "Reconciled" : "Reconcile"} ${state.account.name}`}
        maxWidthClass="max-w-[60rem]"
        description={`Statement ending ${formatDay(state.rec.statementDate, "long")}`}
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-4 lg:px-10">
        <RecWorkspace
          bookId={book.id}
          rec={{
            id: state.rec.id,
            status: state.rec.status,
            beginningCents: state.rec.beginningBalanceCents,
            statementCents: state.rec.statementBalanceCents,
            finishedAt: state.rec.finishedAt ? state.rec.finishedAt.toISOString() : null,
          }}
          liability={state.account.type === "liability"}
          items={state.items}
          canEdit={book.role !== "viewer"}
          canUndo={finished && latestFinished?.rec.id === state.rec.id}
        />
      </div>
    </>
  );
}

export default function RecPage(props: PageProps<"/books/[bookId]/reconcile/[recId]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <RecContent {...props} />
    </Suspense>
  );
}
