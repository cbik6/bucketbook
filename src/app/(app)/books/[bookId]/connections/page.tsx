import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { accountPath } from "@/lib/account-tree";
import { listAccounts } from "@/server/accounts/service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { listConnections } from "@/server/simplefin/service";
import { ConnectForm, ConnectionCard, type MappingTarget } from "./connection-ui";

export const metadata: Metadata = { title: "Bank connections" };

async function ConnectionsContent({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/connections">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { user, book } = await loadBookForPage(bookId, "editor");
  const db = getDb();
  const [connections, rows] = await Promise.all([
    listConnections(db, user.id, book.id),
    listAccounts(db, book.id),
  ]);
  // Which ledger accounts already take a bank feed, so the picker can say so.
  const fedBy = new Map<string, string>();
  for (const c of connections)
    for (const f of c.feeds) if (f.accountId) fedBy.set(f.accountId, f.name);
  const target: MappingTarget = {
    id: book.id,
    name: book.name,
    accounts: rows
      .filter(
        (a) =>
          (a.type === "asset" || a.type === "liability") &&
          (a.allowsPosting || a.bucketsEnabled) &&
          !a.isBucket &&
          !a.systemRole &&
          !a.archivedAt,
      )
      .map((a) => ({
        id: a.id,
        label: accountPath(rows, a.id).join(": "),
        type: a.type,
        fedBy: fedBy.get(a.id) ?? null,
      })),
  };
  const timeZone = process.env.TZ || "UTC";
  const isOwner = book.role === "owner";

  return (
    <>
      <PageHeader
        title="Bank connections"
        maxWidthClass="max-w-[60rem]"
        description={`SimpleFIN brings in transactions from your banks for ${book.name}. They wait in For review until you approve them. Each book has its own connections, so another book can connect the same bank and keep its own transactions.`}
      />
      <div className="box-content flex max-w-[60rem] flex-col gap-10 px-5 pb-16 pt-6 lg:px-10">
        {connections.map((c) => (
          <ConnectionCard
            key={c.id}
            connection={c}
            target={target}
            timeZone={timeZone}
            isOwner={isOwner}
            autoSetup={sp.setup === c.id}
          />
        ))}
        {book.archivedAt ? null : isOwner ? (
          <ConnectForm bookId={book.id} first={connections.length === 0} />
        ) : connections.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No banks are connected to this book yet. An owner of the book can connect one.
          </p>
        ) : null}
      </div>
    </>
  );
}

export default function ConnectionsPage(props: PageProps<"/books/[bookId]/connections">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ConnectionsContent {...props} />
    </Suspense>
  );
}
