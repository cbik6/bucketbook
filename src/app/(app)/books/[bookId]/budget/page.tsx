import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { isMonth } from "@/server/reports/budget-service";
import { budgetForMonth, profitAndLoss } from "@/server/reports/service";
import { BudgetEditor } from "./budget-editor";

export const metadata: Metadata = { title: "Budget" };

function monthEnd(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/budget">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const today = serverToday();
  const requested = typeof sp.month === "string" ? sp.month : "";
  const month = isMonth(requested) ? requested : today.slice(0, 7);
  const db = getDb();
  const [budget, pl] = await Promise.all([
    budgetForMonth(db, book.id, month),
    profitAndLoss(db, book.id, { from: `${month}-01`, to: monthEnd(month) }),
  ]);
  return (
    <>
      <PageHeader
        title="Budget"
        maxWidthClass="max-w-[56rem]"
        description="A monthly amount for each income and expense account. Compare in Reports, Budget vs. Actuals."
      />
      <div className="box-content max-w-[56rem] px-5 pb-16 pt-6 lg:px-10">
        <BudgetEditor
          key={`${month}:${[...budget.entries()].map(([k, v]) => k + v).join()}`}
          bookId={book.id}
          month={month}
          lines={pl.lines.map((l) => ({
            id: l.id,
            name: l.name,
            type: l.type,
            depth: l.depth,
            hasChildren: l.hasChildren,
            actualCents: l.totalCents,
            budgetCents: budget.get(l.id) ?? null,
          }))}
          canEdit={book.role !== "viewer"}
        />
      </div>
    </>
  );
}

export default function BudgetPage(props: PageProps<"/books/[bookId]/budget">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
