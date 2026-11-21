import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import type { CsvMapping } from "@/lib/csv-import";
import { bankableAccounts } from "@/server/bank/accounts";
import { getCsvPreset } from "@/server/bank/csv-service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { CsvImporter } from "./csv-importer";
import { PdfImporter } from "./pdf-importer";

export const metadata: Metadata = { title: "Import transactions" };

const KINDS = [
  { id: "csv", label: "CSV file" },
  { id: "pdf", label: "PDF statement" },
] as const;

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
  const initialAccountId = accounts.some((a) => a.id === initial) ? initial : "";
  const kind = sp.type === "pdf" ? "pdf" : "csv";
  const base = `/books/${book.id}/import`;
  const list = accounts.map((a) => ({ id: a.id, name: a.name, type: a.type }));

  return (
    <>
      <PageHeader
        title="Import transactions"
        maxWidthClass="max-w-[60rem]"
        description="For accounts SimpleFIN can't reach, or older history. Rows go to For review; nothing posts until you approve it."
      />
      <div className="box-content flex max-w-[60rem] flex-col gap-6 px-5 pb-16 pt-4 lg:px-10">
        <nav aria-label="Import from" className="-mb-px flex gap-1 border-b border-rule">
          {KINDS.map((k) => {
            const params = new URLSearchParams();
            if (k.id === "pdf") params.set("type", "pdf");
            if (initialAccountId) params.set("account", initialAccountId);
            const query = params.toString();
            return (
              <Link
                key={k.id}
                href={query ? `${base}?${query}` : base}
                replace
                scroll={false}
                aria-current={k.id === kind ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center border-b-2 px-3 pb-2.5 pt-1 text-sm transition-colors duration-150 ${
                  k.id === kind
                    ? "border-signal font-medium text-ink"
                    : "border-transparent text-ink-muted hover:text-ink"
                }`}
              >
                {k.label}
              </Link>
            );
          })}
        </nav>
        {kind === "pdf" ? (
          <PdfImporter bookId={book.id} accounts={list} initialAccountId={initialAccountId} />
        ) : (
          <CsvImporter
            bookId={book.id}
            accounts={list}
            presets={presets}
            initialAccountId={initialAccountId}
          />
        )}
      </div>
    </>
  );
}

export default function ImportPage(props: PageProps<"/books/[bookId]/import">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ImportContent {...props} />
    </Suspense>
  );
}
