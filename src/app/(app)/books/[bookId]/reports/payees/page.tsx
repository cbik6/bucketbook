import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { bookFirstDay } from "@/server/ledger/queries";
import { spendingByPayee } from "@/server/reports/service";
import { CsvButton, csvHref, reportRange } from "../report-kit";

export const metadata: Metadata = { title: "Spending by payee" };

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/reports/payees">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const { range, from, to } = reportRange(
    sp,
    await bookFirstDay(getDb(), book.id, serverToday()),
    serverToday(),
    "ytd",
  );
  const rows = await spendingByPayee(getDb(), book.id, { from, to });
  const base = `/books/${book.id}`;
  const biggest = Math.max(0, ...rows.map((r) => r.spentCents));
  const spent = rows.reduce((n, r) => n + r.spentCents, 0);
  const received = rows.reduce((n, r) => n + r.receivedCents, 0);
  return (
    <>
      <PageHeader
        title="Spending by payee"
        description={`${range.label}. What went to each payee, and what came from them. Refunds count against spending.`}
        actions={<CsvButton href={csvHref(book.id, "payees", { from, to })} />}
      />
      <div className="flex flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        <RangePicker basePath={`${base}/reports/payees`} range={range} />
        {rows.length === 0 ? (
          <p className="text-sm text-ink-muted">No spending or income in this range.</p>
        ) : (
          <div className="max-w-[60rem] overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Payee
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">
                    Entries
                  </th>
                  <th scope="col" className="w-[40%] py-2 pr-3 text-right font-medium">
                    Spent
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    Received
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.payeeId ?? "text"}:${r.name}`} className="border-b border-rule">
                    <td className="max-w-[16rem] truncate py-2 pr-3">
                      {r.payeeId ? (
                        <Link
                          href={`${base}/journal?${new URLSearchParams({ payee: r.payeeId })}`}
                          className="text-ink underline decoration-rule-strong underline-offset-2 hover:decoration-ink"
                        >
                          {r.name}
                        </Link>
                      ) : (
                        <span className={r.name === "No payee" ? "text-ink-muted" : ""}>
                          {r.name}
                        </span>
                      )}
                    </td>
                    <td className="tabular py-2 pr-3 text-right text-ink-muted">{r.entryCount}</td>
                    <td className="py-2 pr-3">
                      <div className="flex items-center justify-end gap-3">
                        {biggest > 0 && r.spentCents > 0 ? (
                          <span
                            aria-hidden
                            className="hidden h-2 rounded-r-[4px] bg-signal/70 sm:block"
                            style={{ width: `${(r.spentCents / biggest) * 9}rem` }}
                          />
                        ) : null}
                        <Money cents={r.spentCents} blankZero />
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <Money cents={r.receivedCents} blankZero />
                    </td>
                  </tr>
                ))}
                <tr className="border-b border-rule-strong font-semibold">
                  <td className="py-2.5 pr-3">Total</td>
                  <td />
                  <td className="py-2.5 pr-3 text-right">
                    <Money cents={spent} />
                  </td>
                  <td className="py-2.5 text-right">
                    <Money cents={received} />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/payees">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Content {...props} />
    </Suspense>
  );
}
