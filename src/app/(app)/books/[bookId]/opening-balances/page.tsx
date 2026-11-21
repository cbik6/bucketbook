import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { buildAccountTree, flattenTree } from "@/lib/account-tree";
import type { AccountType } from "@/lib/account-types";
import { formatDay } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { serverToday } from "@/server/ledger/page-data";
import { openingBalanceState } from "@/server/ledger/service";
import { saveOpeningBalancesAction } from "./actions";
import { type OpeningGroup, OpeningForm } from "./opening-form";

export const metadata: Metadata = { title: "Opening balances" };

const GROUPS: { type: AccountType; label: string; hint: string }[] = [
  {
    type: "asset",
    label: "What you own",
    hint: "Bank balances, cash, and anything else of value.",
  },
  {
    type: "liability",
    label: "What you owe",
    hint: "Credit card balances and loans, as positive amounts.",
  },
  {
    type: "equity",
    label: "Other equity",
    hint: "Usually left blank for a household. Businesses may have owner contributions.",
  },
];

async function OpeningContent({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/opening-balances">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const state = await openingBalanceState(getDb(), book.id);
  const tree = buildAccountTree(
    state.accounts.map((a) => ({ ...a, archivedAt: a.archivedAt ?? null })),
  );
  const byId = new Map(state.accounts.map((a) => [a.id, a]));
  const today = serverToday();
  const groups: OpeningGroup[] = GROUPS.map((g) => ({
    ...g,
    rows: flattenTree(tree[g.type], { includeArchived: true }).map((n) => {
      const a = byId.get(n.id);
      const adjusted =
        a?.anchored && a.openingDate && a.openingCents !== a.naturalCents
          ? `Opens at ${formatCents(a.openingCents)} on ${formatDay(a.openingDate)}, before its earlier transactions.`
          : null;
      return {
        id: n.id,
        name: n.name,
        code: n.code,
        type: g.type,
        depth: n.depth,
        initial: a?.anchored ? formatCents(a.naturalCents, { showSymbol: false }) : "",
        initialDate: a?.asOf ?? today,
        adjusted,
      };
    }),
  })).filter((g) => g.rows.length > 0);
  const readOnly = book.role === "viewer";
  const base = `/books/${book.id}`;

  return (
    <>
      <PageHeader
        title="Opening balances"
        maxWidthClass="max-w-[44rem]"
        description="What each account held on a date you choose."
      />
      <div className="box-content flex max-w-[44rem] flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        {sp.saved === "1" ? (
          <p role="status" className="rounded-xl bg-signal-soft px-4 py-3 text-sm">
            Opening balances saved.{" "}
            {state.entries.length ? (
              <Link
                href={
                  state.entries.length === 1
                    ? `${base}/journal/${state.entries[0]!.id}`
                    : `${base}/journal`
                }
                className="font-medium text-signal-ink underline"
              >
                {state.entries.length === 1 ? "See the journal entry" : "See the journal"}
              </Link>
            ) : null}
          </p>
        ) : null}
        <div className="flex max-w-prose flex-col gap-2 text-ink-muted">
          <p>
            Enter what each account held on a date, from a statement or your banking app. Today is
            usually easiest. Bank accounts connected through SimpleFIN get this from the bank on the
            day you connect them.
          </p>
          <p>
            You can add older transactions at any time, by hand or from statements. Bucketbook then
            lowers or raises the opening amount so the balance on that date stays exactly what you
            entered.
          </p>
        </div>
        <OpeningForm
          action={saveOpeningBalancesAction.bind(null, book.id)}
          groups={groups}
          readOnly={readOnly}
        />
      </div>
    </>
  );
}

export default function OpeningBalancesPage(props: PageProps<"/books/[bookId]/opening-balances">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <OpeningContent {...props} />
    </Suspense>
  );
}
