import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { AppShell, AppShellFallback, PageHeader } from "@/components/app-shell";
import { accountPath } from "@/lib/account-tree";
import { listAccounts } from "@/server/accounts/service";
import { requireUser } from "@/server/auth/session";
import { listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { editableBooks, listConnections } from "@/server/simplefin/service";
import { ConnectForm, ConnectionCard, type MappingTarget } from "./connection-ui";

export const metadata: Metadata = { title: "Bank connections" };

async function ConnectionsContent() {
  await connection();
  const user = await requireUser();
  const db = getDb();
  const [books, connections, editable] = await Promise.all([
    listBooksForUser(db, user.id),
    listConnections(db, user.id),
    editableBooks(db, user.id),
  ]);
  const targets: MappingTarget[] = [];
  for (const b of editable) {
    const rows = await listAccounts(db, b.id);
    targets.push({
      id: b.id,
      name: b.name,
      accounts: rows
        .filter(
          (a) =>
            (a.type === "asset" || a.type === "liability") &&
            a.allowsPosting &&
            !a.isBucket &&
            !a.systemRole &&
            !a.archivedAt,
        )
        .map((a) => ({ id: a.id, label: accountPath(rows, a.id).join(": "), type: a.type })),
    });
  }
  const timeZone = process.env.TZ || "UTC";

  return (
    <AppShell user={user} books={books}>
      <PageHeader
        title="Bank connections"
        maxWidthClass="max-w-[60rem]"
        description="SimpleFIN brings in transactions from your banks. They wait in For review until you approve them."
      />
      <div className="box-content flex max-w-[60rem] flex-col gap-10 px-5 pb-16 pt-6 lg:px-10">
        {connections.map((c) => (
          <ConnectionCard key={c.id} connection={c} targets={targets} timeZone={timeZone} />
        ))}
        <ConnectForm first={connections.length === 0} />
      </div>
    </AppShell>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<AppShellFallback />}>
      <ConnectionsContent />
    </Suspense>
  );
}
