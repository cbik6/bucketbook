import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { bankableAccounts } from "@/server/bank/accounts";
import { listRules } from "@/server/bank/rules-service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { entryFormAccounts } from "@/server/ledger/page-data";
import { RulesManager } from "./rules-manager";

export const metadata: Metadata = { title: "Rules" };

async function RulesContent({ params }: PageProps<"/books/[bookId]/rules">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const db = getDb();
  const [rules, groups, bank] = await Promise.all([
    listRules(db, book.id),
    entryFormAccounts(book.id),
    bankableAccounts(db, book.id),
  ]);
  return (
    <>
      <PageHeader
        title="Rules"
        maxWidthClass="max-w-[60rem]"
        description="Rules fill in the category, payee and memo for new bank transactions. They only suggest: you still approve each one in For review."
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <RulesManager
          bookId={book.id}
          rules={rules}
          groups={groups}
          bankAccounts={bank.map((a) => ({ id: a.id, name: a.name }))}
          canEdit={book.role !== "viewer"}
        />
      </div>
    </>
  );
}

export default function RulesPage(props: PageProps<"/books/[bookId]/rules">) {
  return (
    <Suspense>
      <RulesContent {...props} />
    </Suspense>
  );
}
