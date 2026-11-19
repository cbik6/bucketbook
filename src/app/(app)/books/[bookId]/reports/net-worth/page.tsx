import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { monthLabel } from "@/components/charts/chart-utils";
import { LineChart } from "@/components/charts/line-chart";
import { Money } from "@/components/money";
import { formatCents } from "@/lib/money";
import { RangePicker } from "@/components/range-picker";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { netWorthByMonth } from "@/server/reports/service";
import { CsvButton, csvHref, reportRange } from "../report-kit";

export const metadata: Metadata = { title: "Net worth" };

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/reports/net-worth">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const { range, from, to } = reportRange(sp, book.startDate, serverToday(), "all");
  const rows = await netWorthByMonth(getDb(), book.id, { from, to });
  const base = `/books/${book.id}`;
  const latest = rows.at(-1);
  const first = rows[0];
  return (
    <>
      <PageHeader
        title="Net worth"
        description={`${range.label}. Assets minus liabilities at the end of each month.`}
        actions={<CsvButton href={csvHref(book.id, "net-worth", { from, to })} />}
      />
      <div className="flex flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        <RangePicker basePath={`${base}/reports/net-worth`} range={range} />
        {latest ? (
          <div className="flex flex-wrap gap-8">
            <div>
              <div className="text-[0.8125rem] text-ink-muted">
                Net worth, {monthLabel(latest.month, true)}
              </div>
              <Money
                cents={latest.netWorthCents}
                className="text-3xl font-semibold tracking-[-0.02em]"
              />
            </div>
            {first && first !== latest ? (
              <div>
                <div className="text-[0.8125rem] text-ink-muted">
                  Since {monthLabel(first.month, true)}
                </div>
                <div className="tabular text-xl font-semibold">
                  {latest.netWorthCents >= first.netWorthCents ? "Up " : "Down "}
                  {formatCents(Math.abs(latest.netWorthCents - first.netWorthCents))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="max-w-[60rem]">
          <LineChart
            points={rows.map((r) => ({ month: r.month, value: r.netWorthCents }))}
            label={`Net worth by month, ${range.label}`}
            seriesName="Net worth"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full max-w-[40rem] text-sm">
            <caption className="mb-2 text-left text-[0.8125rem] font-medium text-ink">
              Table view
            </caption>
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Month end
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Assets
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Liabilities
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Net worth
                </th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.month} className="border-b border-rule">
                  <td className="py-2 pr-3">{monthLabel(r.month, true)}</td>
                  <td className="py-2 pr-3 text-right">
                    <Money cents={r.assetsCents} />
                  </td>
                  <td className="py-2 pr-3 text-right">
                    <Money cents={r.liabilitiesCents} />
                  </td>
                  <td className="py-2 text-right font-medium">
                    <Money cents={r.netWorthCents} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/net-worth">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Content {...props} />
    </Suspense>
  );
}
