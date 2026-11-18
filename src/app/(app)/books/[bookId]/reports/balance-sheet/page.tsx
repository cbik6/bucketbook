import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { formatDay, isIsoDate } from "@/lib/dates";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { balanceSheet } from "@/server/reports/service";
import {
  CsvButton,
  EmptyToggle,
  LineRows,
  SectionHead,
  TotalRow,
  csvHref,
  one,
  withoutEmpty,
} from "../report-kit";

export const metadata: Metadata = { title: "Balance Sheet" };

async function Content({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/reports/balance-sheet">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const requested = one(sp.asOf);
  const asOf = isIsoDate(requested) ? requested : serverToday();
  const bs = await balanceSheet(getDb(), book.id, asOf);
  const base = `/books/${book.id}`;
  const showEmpty = one(sp.empty) === "1";
  const lines = withoutEmpty(bs.lines, showEmpty);
  const hiddenCount = bs.lines.length - withoutEmpty(bs.lines, false).length;
  const emptyHref = `${base}/reports/balance-sheet?${new URLSearchParams({
    asOf,
    ...(showEmpty ? {} : { empty: "1" }),
  })}`;
  return (
    <>
      <PageHeader
        title="Balance Sheet"
        description={`As of ${formatDay(asOf, "long")}.`}
        actions={<CsvButton href={csvHref(book.id, "balance-sheet", { asOf })} />}
      />
      <div className="flex flex-col gap-5 px-5 pb-16 pt-6 lg:px-10">
        <form className="flex flex-wrap items-end gap-2" action={`${base}/reports/balance-sheet`}>
          <label className="flex flex-col gap-1.5 text-[0.8125rem] font-medium text-ink">
            As of
            <input
              type="date"
              name="asOf"
              defaultValue={asOf}
              className="tabular h-10 rounded-lg border border-field-border bg-surface px-3 text-sm"
            />
          </label>
          <button
            type="submit"
            className="h-10 rounded-full border border-field-border px-4 text-sm hover:border-ink-muted"
          >
            Show
          </button>
        </form>
        <div>
          <EmptyToggle href={emptyHref} hidden={hiddenCount} showing={showEmpty} />
        </div>
        {bs.outOfBalanceCents !== 0 ? (
          <p
            role="alert"
            className="rounded-lg border border-negative/40 bg-negative-soft px-3 py-2.5 text-sm text-negative"
          >
            Assets and liabilities plus equity differ by <Money cents={bs.outOfBalanceCents} />.
            This should never happen; please report it.
          </p>
        ) : null}
        <table className="w-full max-w-[48rem] text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Account
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Balance
              </th>
            </tr>
          </thead>
          <tbody>
            <SectionHead label="Assets" span={2} />
            <LineRows lines={lines.filter((l) => l.type === "asset")} base={base} to={asOf} />
            <TotalRow label="Total assets" cents={bs.assetsCents} strong />
            <SectionHead label="Liabilities" span={2} />
            <LineRows lines={lines.filter((l) => l.type === "liability")} base={base} to={asOf} />
            <TotalRow label="Total liabilities" cents={bs.liabilitiesCents} />
            <SectionHead label="Equity" span={2} />
            <LineRows lines={lines.filter((l) => l.type === "equity")} base={base} to={asOf} />
            {bs.retainedEarningsCents !== 0 || showEmpty ? (
              <tr className="border-b border-rule">
                <td className="py-2 pr-3 text-ink">
                  Retained earnings{" "}
                  <span className="text-ink-muted">(before {asOf.slice(0, 4)})</span>
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money cents={bs.retainedEarningsCents} />
                </td>
              </tr>
            ) : null}
            <tr className="border-b border-rule">
              <td className="py-2 pr-3 text-ink">
                Net income <span className="text-ink-muted">({asOf.slice(0, 4)} so far)</span>
              </td>
              <td className="py-2 pr-3 text-right">
                <Money cents={bs.netIncomeCents} />
              </td>
            </tr>
            <TotalRow label="Total equity" cents={bs.equityCents} />
            <TotalRow
              label="Total liabilities and equity"
              cents={bs.liabilitiesCents + bs.equityCents}
              strong
            />
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/balance-sheet">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
