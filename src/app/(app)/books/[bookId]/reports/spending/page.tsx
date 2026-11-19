import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { monthLabel } from "@/components/charts/chart-utils";
import { StackedColumns } from "@/components/charts/stacked-columns";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { spendingByMonth } from "@/server/reports/service";
import { CsvButton, csvHref, reportRange } from "../report-kit";

export const metadata: Metadata = { title: "Spending trends" };

/** The five biggest categories by name; the rest fold into Other. */
const TOP = 5;

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/reports/spending">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const { range, from, to } = reportRange(sp, book.startDate, serverToday(), "ytd");
  const data = await spendingByMonth(getDb(), book.id, { from, to });
  const shown = data.series.slice(0, TOP);
  const rest = data.series.slice(TOP);
  const series = rest.length
    ? [
        ...shown,
        {
          id: "other",
          name: "Other",
          totalCents: rest.reduce((n, s) => n + s.totalCents, 0),
          values: data.months.map((_, i) => rest.reduce((n, s) => n + (s.values[i] ?? 0), 0)),
        },
      ]
    : shown;
  const base = `/books/${book.id}`;
  const monthTotals = data.months.map((_, i) =>
    data.series.reduce((n, s) => n + (s.values[i] ?? 0), 0),
  );
  return (
    <>
      <PageHeader
        title="Spending trends"
        description={`${range.label}. Expenses by category, each month.`}
        actions={<CsvButton href={csvHref(book.id, "spending", { from, to })} />}
      />
      <div className="flex flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        <RangePicker basePath={`${base}/reports/spending`} range={range} />
        {series.length === 0 ? (
          <p className="text-sm text-ink-muted">No spending in this range.</p>
        ) : (
          <>
            <div className="max-w-[60rem]">
              <StackedColumns
                months={data.months}
                series={series}
                label={`Spending by category per month, ${range.label}`}
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="mb-2 text-left text-[0.8125rem] font-medium text-ink">
                  Table view
                </caption>
                <thead>
                  <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Category
                    </th>
                    {data.months.map((m) => (
                      <th key={m} scope="col" className="py-2 pr-3 text-right font-medium">
                        {monthLabel(m, true)}
                      </th>
                    ))}
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Total
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.series.map((s) => (
                    <tr key={s.id} className="border-b border-rule">
                      <td className="py-2 pr-3">{s.name}</td>
                      {s.values.map((v, i) => (
                        <td key={data.months[i]} className="py-2 pr-3 text-right">
                          <Money cents={v} blankZero />
                        </td>
                      ))}
                      <td className="py-2 pr-3 text-right font-medium">
                        <Money cents={s.totalCents} />
                      </td>
                    </tr>
                  ))}
                  <tr className="border-b border-rule-strong font-semibold">
                    <td className="py-2.5 pr-3">Total</td>
                    {monthTotals.map((v, i) => (
                      <td key={data.months[i]} className="py-2.5 pr-3 text-right">
                        <Money cents={v} />
                      </td>
                    ))}
                    <td className="py-2.5 pr-3 text-right">
                      <Money cents={monthTotals.reduce((n, v) => n + v, 0)} />
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/spending">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Content {...props} />
    </Suspense>
  );
}
