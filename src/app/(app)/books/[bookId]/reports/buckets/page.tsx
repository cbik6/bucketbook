import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { FillLine } from "@/components/ui/fill-line";
import { formatCents } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { bucketSummary } from "@/server/reports/service";
import { CsvButton, csvHref, reportRange } from "../report-kit";

export const metadata: Metadata = { title: "Bucket summary" };

async function Content({ params, searchParams }: PageProps<"/books/[bookId]/reports/buckets">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const today = serverToday();
  const { range, from, to } = reportRange(sp, book.startDate, today, "ytd");
  const parents = await bucketSummary(getDb(), book.id, { from, to }, today);
  const base = `/books/${book.id}`;
  const q = new URLSearchParams({ from, to });
  return (
    <>
      <PageHeader
        title="Bucket summary"
        description={`${range.label}. Money into and out of each bucket, and progress toward goals.`}
        actions={<CsvButton href={csvHref(book.id, "buckets", { from, to })} />}
      />
      <div className="flex flex-col gap-8 px-5 pb-16 pt-6 lg:px-10">
        <RangePicker basePath={`${base}/reports/buckets`} range={range} />
        {parents.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No buckets yet. Turn them on from the{" "}
            <Link href={`${base}/buckets`} className="text-signal-ink underline">
              Buckets
            </Link>{" "}
            page.
          </p>
        ) : null}
        {parents.map((p) => (
          <section key={p.id} className="flex flex-col gap-2">
            <h2 className="text-[0.9375rem] font-semibold text-ink">{p.name}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                    <th scope="col" className="py-2 pr-3 font-medium">
                      Bucket
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Start
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      In
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      Out
                    </th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">
                      End
                    </th>
                    <th scope="col" className="w-48 py-2 font-medium">
                      Goal
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {p.buckets
                    .filter(
                      (b) => !b.archived || b.endCents !== 0 || b.inflowCents || b.outflowCents,
                    )
                    .map((b) => (
                      <tr key={b.id} className="border-b border-rule hover:bg-sunken">
                        <td className="py-2 pr-3">
                          <Link href={`${base}/accounts/${b.id}?${q}`} className="hover:underline">
                            {b.name}
                          </Link>
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Money cents={b.startCents} />
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Money cents={b.inflowCents} blankZero />
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Money cents={b.outflowCents} blankZero />
                        </td>
                        <td className="py-2 pr-3 text-right font-medium">
                          <Money cents={b.endCents} />
                        </td>
                        <td className="py-2">
                          {b.goal && b.goalCents ? (
                            <div className="flex flex-col gap-1">
                              <FillLine
                                value={Math.max(0, b.endCents)}
                                max={b.goalCents}
                                label={`${b.name} goal progress`}
                                instant
                              />
                              <span className="text-xs text-ink-muted">
                                {Math.round(b.goal.fraction * 100)}% of {formatCents(b.goalCents)}
                                {b.goal.monthlyCents
                                  ? `, ${formatCents(b.goal.monthlyCents)} a month to go`
                                  : ""}
                              </span>
                            </div>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export default function Page(props: PageProps<"/books/[bookId]/reports/buckets">) {
  return (
    <Suspense>
      <Content {...props} />
    </Suspense>
  );
}
