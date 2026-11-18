import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { budgetVsActual } from "@/server/reports/service";
import { CsvButton, LineRows, SectionHead, csvHref, reportRange } from "../report-kit";

export const metadata: Metadata = { title: "Budget vs. Actuals" };

async function Content({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/reports/budget-vs-actuals">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const { range, from, to } = reportRange(sp, book.startDate, serverToday(), "this-month");
  const r = await budgetVsActual(getDb(), book.id, { from, to });
  const base = `/books/${book.id}`;
  // Over budget means more spending, or less income, than planned.
  const diffCell = (type: string, actual: number, budget: number) => {
    const over = type === "expense" ? actual - budget : budget - actual;
    return (
      <td className="whitespace-nowrap py-2 text-right">
        {budget === 0 && actual === 0 ? null : over > 0 ? (
          <span className="text-negative">
            <Money cents={over} className="text-negative" /> {type === "expense" ? "over" : "short"}
          </span>
        ) : (
          <span className="text-ink-muted">
            <Money cents={-over} /> {type === "expense" ? "left" : "ahead"}
          </span>
        )}
      </td>
    );
  };
  const extra = (l: (typeof r.lines)[number]) => (
    <>
      <td className="whitespace-nowrap py-2 pr-3 text-right">
        <Money cents={l.budgetCents} blankZero />
      </td>
      {diffCell(l.type, l.totalCents, l.budgetCents)}
    </>
  );
  const head = (
    <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
      <th scope="col" className="py-2 pr-3 font-medium">
        Account
      </th>
      <th scope="col" className="py-2 pr-3 text-right font-medium">
        Actual
      </th>
      <th scope="col" className="py-2 pr-3 text-right font-medium">
        Budget
      </th>
      <th scope="col" className="py-2 text-right font-medium">
        Difference
      </th>
    </tr>
  );
  const total = (label: string, type: string, actual: number, budget: number) => (
    <tr className="border-b border-rule-strong font-semibold">
      <td className="py-2.5 pr-3">{label}</td>
      <td className="py-2.5 pr-3 text-right">
        <Money cents={actual} />
      </td>
      <td className="py-2.5 pr-3 text-right">
        <Money cents={budget} />
      </td>
      {diffCell(type, actual, budget)}
    </tr>
  );
  const rows = (type: "income" | "expense") =>
    r.lines.filter((l) => l.type === type && (l.totalCents !== 0 || l.budgetCents !== 0));
  return (
    <>
      <PageHeader
        title="Budget vs. Actuals"
        description={`${range.label}, ${r.months.length} ${r.months.length === 1 ? "month" : "months"} of budget.`}
        actions={<CsvButton href={csvHref(book.id, "budget-vs-actuals", { from, to })} />}
      />
      <div className="flex flex-col gap-5 px-5 pb-16 pt-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <RangePicker basePath={`${base}/reports/budget-vs-actuals`} range={range} />
          <Link href={`${base}/budget`} className="text-sm font-medium text-signal-ink underline">
            Edit the budget
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] max-w-[56rem] text-sm">
            <thead>{head}</thead>
            <tbody>
              <SectionHead label="Income" span={4} />
              <LineRows lines={rows("income")} base={base} from={from} to={to} extra={extra} />
              {total("Total income", "income", r.income.actual, r.income.budget)}
              <SectionHead label="Expenses" span={4} />
              <LineRows lines={rows("expense")} base={base} from={from} to={to} extra={extra} />
              {total("Total expenses", "expense", r.expense.actual, r.expense.budget)}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/budget-vs-actuals">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
