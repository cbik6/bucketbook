import { isIsoDate, todayIso } from "@/lib/dates";
import { getCurrentUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import {
  type ReportLine,
  balanceSheet,
  bucketSummary,
  budgetVsActual,
  centsCsv,
  netWorthByMonth,
  profitAndLoss,
  spendingByMonth,
  toCsv,
} from "@/server/reports/service";

const indent = (l: ReportLine) => `${"  ".repeat(l.depth)}${l.name}`;

/** CSV export of a report, with the same parameters as its page. */
export async function GET(
  request: Request,
  ctx: RouteContext<"/api/books/[bookId]/reports/[report]">,
) {
  const { bookId, report } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });
  let book;
  try {
    book = await requireBookAccess(getDb(), user.id, bookId, "viewer");
  } catch (err) {
    if (err instanceof UserFacingError) return new Response("Not found.", { status: 404 });
    throw err;
  }
  const url = new URL(request.url);
  const today = todayIso(process.env.TZ || undefined);
  const param = (k: string, fallback: string) => {
    const v = url.searchParams.get(k);
    return v && isIsoDate(v) ? v : fallback;
  };
  const from = param("from", book.startDate);
  const to = param("to", today);
  const db = getDb();
  let rows: (string | number)[][];

  switch (report) {
    case "profit-loss": {
      const monthly = url.searchParams.get("monthly") === "1";
      const pl = await profitAndLoss(db, book.id, { from, to }, { monthly });
      const head = ["Account", "Type", ...pl.months, "Total"];
      const line = (l: ReportLine) => [
        indent(l),
        l.type,
        ...pl.months.map((m) => centsCsv(l.columns?.[m] ?? 0)),
        centsCsv(l.totalCents),
      ];
      rows = [
        head,
        ...pl.lines.map(line),
        [
          "Total income",
          "",
          ...pl.months.map((m) => centsCsv(pl.incomeColumns[m] ?? 0)),
          centsCsv(pl.incomeCents),
        ],
        [
          "Total expenses",
          "",
          ...pl.months.map((m) => centsCsv(pl.expenseColumns[m] ?? 0)),
          centsCsv(pl.expenseCents),
        ],
        [
          "Net income",
          "",
          ...pl.months.map((m) => centsCsv(pl.netColumns[m] ?? 0)),
          centsCsv(pl.netIncomeCents),
        ],
      ];
      break;
    }
    case "balance-sheet": {
      const asOf = param("asOf", today);
      const bs = await balanceSheet(db, book.id, asOf);
      rows = [
        ["Account", "Type", `Balance ${asOf}`],
        ...bs.lines.map((l) => [indent(l), l.type, centsCsv(l.totalCents)]),
        ["Retained earnings", "equity", centsCsv(bs.retainedEarningsCents)],
        ["Net income this year", "equity", centsCsv(bs.netIncomeCents)],
        ["Total assets", "", centsCsv(bs.assetsCents)],
        ["Total liabilities", "", centsCsv(bs.liabilitiesCents)],
        ["Total equity", "", centsCsv(bs.equityCents)],
      ];
      break;
    }
    case "budget-vs-actuals": {
      const r = await budgetVsActual(db, book.id, { from, to });
      rows = [
        ["Account", "Type", "Actual", "Budget"],
        ...r.lines.map((l) => [indent(l), l.type, centsCsv(l.totalCents), centsCsv(l.budgetCents)]),
      ];
      break;
    }
    case "buckets": {
      const parents = await bucketSummary(db, book.id, { from, to }, today);
      rows = [
        ["Account", "Bucket", "Start", "In", "Out", "End", "Goal", "Goal date"],
        ...parents.flatMap((p) =>
          p.buckets.map((b) => [
            p.name,
            b.name,
            centsCsv(b.startCents),
            centsCsv(b.inflowCents),
            centsCsv(b.outflowCents),
            centsCsv(b.endCents),
            b.goalCents ? centsCsv(b.goalCents) : "",
            b.goalDate ?? "",
          ]),
        ),
      ];
      break;
    }
    case "spending": {
      const s = await spendingByMonth(db, book.id, { from, to });
      rows = [
        ["Category", ...s.months, "Total"],
        ...s.series.map((x) => [x.name, ...x.values.map(centsCsv), centsCsv(x.totalCents)]),
      ];
      break;
    }
    case "net-worth": {
      const n = await netWorthByMonth(db, book.id, { from, to });
      rows = [
        ["Month", "Assets", "Liabilities", "Net worth"],
        ...n.map((m) => [
          m.month,
          centsCsv(m.assetsCents),
          centsCsv(m.liabilitiesCents),
          centsCsv(m.netWorthCents),
        ]),
      ];
      break;
    }
    default:
      return new Response("Not found.", { status: 404 });
  }

  const name =
    `${book.name}-${report}-${report === "balance-sheet" ? param("asOf", today) : `${from}-to-${to}`}`
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, 120);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
