import { BarChart3, Gauge, Landmark, LineChart, PiggyBank, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { loadBookForPage } from "@/server/guards";

export const metadata: Metadata = { title: "Reports" };

const REPORTS = [
  {
    slug: "profit-loss",
    title: "Profit and Loss",
    text: "Income and expenses for a period, with monthly columns if you like.",
    Icon: BarChart3,
  },
  {
    slug: "balance-sheet",
    title: "Balance Sheet",
    text: "What you own, what you owe, and equity on a date.",
    Icon: Scale,
  },
  {
    slug: "budget-vs-actuals",
    title: "Budget vs. Actuals",
    text: "How each category is doing against its budget.",
    Icon: Gauge,
  },
  {
    slug: "buckets",
    title: "Bucket summary",
    text: "Each bucket's balance, money in and out, and goal progress.",
    Icon: PiggyBank,
  },
  {
    slug: "spending",
    title: "Spending trends",
    text: "Expenses by category, month by month.",
    Icon: LineChart,
  },
  {
    slug: "net-worth",
    title: "Net worth",
    text: "Assets minus liabilities at each month's end.",
    Icon: Landmark,
  },
];

async function ReportsContent({ params }: PageProps<"/books/[bookId]/reports">) {
  await connection();
  const { bookId } = await params;
  const { book } = await loadBookForPage(bookId);
  return (
    <>
      <PageHeader
        title="Reports"
        maxWidthClass="max-w-[60rem]"
        description="Every number links to the transactions behind it, and every report exports to CSV."
      />
      <div className="box-content max-w-[60rem] px-5 pb-16 pt-6 lg:px-10">
        <ul className="grid gap-3 sm:grid-cols-2">
          {REPORTS.map(({ slug, title, text, Icon }) => (
            <li key={slug}>
              <Link
                href={`/books/${book.id}/reports/${slug}`}
                className="flex h-full gap-3 rounded-xl border border-rule p-4 transition-colors duration-150 hover:border-ink-muted hover:bg-sunken"
              >
                <Icon size={18} aria-hidden className="mt-0.5 shrink-0 text-signal-ink" />
                <span>
                  <span className="block font-semibold text-ink">{title}</span>
                  <span className="block text-sm text-ink-muted">{text}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
        <p className="mt-6 text-sm text-ink-muted">
          The{" "}
          <Link
            href={`/books/${book.id}/ledger`}
            className="text-signal-ink underline underline-offset-2"
          >
            general ledger
          </Link>{" "}
          and each account&apos;s register show every line behind these reports.
        </p>
      </div>
    </>
  );
}

export default function ReportsPage(props: PageProps<"/books/[bookId]/reports">) {
  return (
    <Suspense>
      <ReportsContent {...props} />
    </Suspense>
  );
}
