import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { formatDay } from "@/lib/dates";
import { bankableAccounts } from "@/server/bank/accounts";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { listReconciliations, toNatural } from "@/server/reconcile/service";
import { StartForm } from "./start-form";

export const metadata: Metadata = { title: "Reconcile" };

async function ReconcileContent({ params }: PageProps<"/books/[bookId]/reconcile">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  const db = getDb();
  const [list, accounts] = await Promise.all([
    listReconciliations(db, book.id),
    bankableAccounts(db, book.id),
  ]);
  const base = `/books/${book.id}/reconcile`;
  const open = list.filter((r) => r.rec.status === "open");
  const done = list.filter((r) => r.rec.status === "finished");
  const lastByAccount = new Map<string, string>();
  for (const r of done)
    if (!lastByAccount.has(r.rec.accountId))
      lastByAccount.set(r.rec.accountId, r.rec.statementDate);
  return (
    <>
      <PageHeader
        title="Reconcile"
        maxWidthClass="max-w-[60rem]"
        description="Match the books to a bank or card statement: check off what cleared until the difference is zero."
      />
      <div className="box-content flex max-w-[60rem] flex-col gap-10 px-5 pb-16 pt-6 lg:px-10">
        {open.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">In progress</h2>
            <ul className="flex flex-col border-t border-rule">
              {open.map((r) => (
                <li
                  key={r.rec.id}
                  className="flex items-center justify-between border-b border-rule py-3 text-sm"
                >
                  <span>
                    {r.accountName}, statement ending {formatDay(r.rec.statementDate)}
                  </span>
                  <Link
                    href={`${base}/${r.rec.id}`}
                    className="font-medium text-signal-ink hover:underline"
                  >
                    Continue
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {book.role !== "viewer" ? (
          <StartForm
            bookId={book.id}
            today={serverToday()}
            accounts={accounts.map((a) => ({
              id: a.id,
              name: a.name,
              lastReconciled: lastByAccount.get(a.id) ?? null,
            }))}
          />
        ) : null}
        <section className="flex flex-col gap-2">
          <h2 className="text-[0.9375rem] font-semibold text-ink">History</h2>
          {done.length === 0 ? (
            <p className="text-sm text-ink-muted">No finished reconciliations yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                  <th className="py-2 pr-3 font-medium">Account</th>
                  <th className="py-2 pr-3 font-medium">Statement ending</th>
                  <th className="py-2 pr-3 text-right font-medium">Balance</th>
                  <th className="py-2 font-medium">
                    <span className="sr-only">Report</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {done.map((r) => (
                  <tr key={r.rec.id} className="border-b border-rule">
                    <td className="py-2.5 pr-3">{r.accountName}</td>
                    <td className="tabular py-2.5 pr-3 text-ink-muted">
                      {formatDay(r.rec.statementDate)}
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Money cents={toNatural(r.accountType, r.rec.statementBalanceCents)} />
                    </td>
                    <td className="py-2.5 text-right">
                      <Link
                        href={`${base}/${r.rec.id}`}
                        className="text-signal-ink hover:underline"
                      >
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}

export default function ReconcilePage(props: PageProps<"/books/[bookId]/reconcile">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <ReconcileContent {...props} />
    </Suspense>
  );
}
