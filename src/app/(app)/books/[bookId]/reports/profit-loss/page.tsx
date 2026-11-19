import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { monthLabel } from "@/components/charts/chart-utils";
import { RangePicker } from "@/components/range-picker";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { profitAndLoss } from "@/server/reports/service";
import {
  CsvButton,
  EmptyToggle,
  LineRows,
  SectionHead,
  TotalRow,
  csvHref,
  one,
  reportRange,
  withoutEmpty,
} from "../report-kit";

export const metadata: Metadata = { title: "Profit and Loss" };

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/reports/profit-loss">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const { range, from, to } = reportRange(sp, book.startDate, serverToday(), "ytd");
  const monthly = one(sp.monthly) === "1";
  const pl = await profitAndLoss(getDb(), book.id, { from, to }, { monthly });
  const base = `/books/${book.id}`;
  const cols = monthly ? pl.months : undefined;
  const span = 2 + (cols?.length ?? 0);
  const showEmpty = one(sp.empty) === "1";
  const keep = { monthly: monthly ? "1" : undefined, empty: showEmpty ? "1" : undefined };
  const rangeQ: Record<string, string> =
    range.preset === "custom" ? { from, to } : { range: range.preset };
  const toggle = new URLSearchParams({
    ...rangeQ,
    ...(monthly ? {} : { monthly: "1" }),
    ...(showEmpty ? { empty: "1" } : {}),
  });
  const emptyHref = `${base}/reports/profit-loss?${new URLSearchParams({
    ...rangeQ,
    ...(monthly ? { monthly: "1" } : {}),
    ...(showEmpty ? {} : { empty: "1" }),
  })}`;
  const lines = withoutEmpty(pl.lines, showEmpty);
  const hiddenCount = pl.lines.length - withoutEmpty(pl.lines, false).length;
  return (
    <>
      <PageHeader
        title="Profit and Loss"
        description={`${range.label}. Income and expenses by account.`}
        actions={
          <CsvButton
            href={csvHref(book.id, "profit-loss", { from, to, monthly: monthly ? "1" : undefined })}
          />
        }
      />
      <div className="flex flex-col gap-5 px-5 pb-16 pt-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <RangePicker basePath={`${base}/reports/profit-loss`} range={range} keep={keep} />
          <Link
            href={`${base}/reports/profit-loss?${toggle}`}
            className="text-sm font-medium text-signal-ink underline"
            aria-pressed={monthly}
          >
            {monthly ? "Totals only" : "Show monthly columns"}
          </Link>
        </div>
        <div>
          <EmptyToggle href={emptyHref} hidden={hiddenCount} showing={showEmpty} />
        </div>
        <div className="overflow-x-auto">
          <table className={`w-full text-sm ${cols ? "min-w-[48rem]" : "max-w-[48rem]"}`}>
            <thead>
              <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Account
                </th>
                {cols?.map((m) => (
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
              <SectionHead label="Income" span={span} />
              <LineRows
                lines={lines.filter((l) => l.type === "income")}
                base={base}
                from={from}
                to={to}
                columns={cols}
              />
              <TotalRow
                label="Total income"
                cents={pl.incomeCents}
                columns={cols?.map((m) => ({ key: m, cents: pl.incomeColumns[m] ?? 0 }))}
              />
              <SectionHead label="Expenses" span={span} />
              <LineRows
                lines={lines.filter((l) => l.type === "expense")}
                base={base}
                from={from}
                to={to}
                columns={cols}
              />
              <TotalRow
                label="Total expenses"
                cents={pl.expenseCents}
                columns={cols?.map((m) => ({ key: m, cents: pl.expenseColumns[m] ?? 0 }))}
              />
              <TotalRow
                label="Net income"
                cents={pl.netIncomeCents}
                columns={cols?.map((m) => ({ key: m, cents: pl.netColumns[m] ?? 0 }))}
                strong
              />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/profit-loss">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Content {...props} />
    </Suspense>
  );
}
