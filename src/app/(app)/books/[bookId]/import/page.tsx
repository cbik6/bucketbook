import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import type { CsvMapping } from "@/lib/csv-import";
import { bankableAccounts } from "@/server/bank/accounts";
import { getCsvPreset } from "@/server/bank/csv-service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { CsvImporter } from "./csv-importer";

export const metadata: Metadata = { title: "Import CSV" };

async function ImportContent({ params, searchParams }: PageProps<"/books/[bookId]/import">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId, "editor");
  const db = getDb();
  const accounts = await bankableAccounts(db, book.id);
  const presets: Record<string, CsvMapping> = {};
  for (const a of accounts) {
    const p = await getCsvPreset(db, a.id);
    if (p) presets[a.id] = p;
  }
  const initial = typeof sp.account === "string" ? sp.account : "";
  return (
    <>
      <PageHeader
        title="Import CSV"
        maxWidthClass="max-w-[60rem]"
        description="For accounts SimpleFIN can't reach, or older history. Rows go to For review; nothing posts until you approve it."
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <CsvImporter
          bookId={book.id}
          startDate={book.startDate}
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }))}
          presets={presets}
          initialAccountId={accounts.some((a) => a.id === initial) ? initial : ""}
        />
      </div>
    </>
  );
}

export default function ImportPage(props: PageProps<"/books/[bookId]/import">) {
  return (
    <Suspense>
      <ImportContent {...props} />
    </Suspense>
  );
}
