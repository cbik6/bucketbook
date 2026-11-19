import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageFallback, PageHeader } from "@/components/app-shell";
import { buildAccountTree, flattenTree } from "@/lib/account-tree";
import type { AccountType } from "@/lib/account-types";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { formatCents } from "@/lib/money";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { openingBalanceState } from "@/server/ledger/service";
import { saveOpeningBalancesAction } from "./actions";
import { type OpeningGroup, OpeningForm } from "./opening-form";

export const metadata: Metadata = { title: "Opening balances" };

const GROUPS: { type: AccountType; label: string; hint: string }[] = [
  {
    type: "asset",
    label: "What you own",
    hint: "Bank balances, cash, and anything else of value, as of the start date.",
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
  const amount = new Map(state.accounts.map((a) => [a.id, a.naturalCents]));
  const groups: OpeningGroup[] = GROUPS.map((g) => ({
    ...g,
    rows: flattenTree(tree[g.type], { includeArchived: true }).map((n) => ({
      id: n.id,
      name: n.name,
      code: n.code,
      type: g.type,
      depth: n.depth,
      initial: amount.get(n.id) ? formatCents(amount.get(n.id)!, { showSymbol: false }) : "",
    })),
  })).filter((g) => g.rows.length > 0);
  const readOnly = book.role === "viewer" || Boolean(state.reversedByNumber);
  const base = `/books/${book.id}`;

  return (
    <>
      <PageHeader
        title="Opening balances"
        maxWidthClass="max-w-[44rem]"
        description={`As of your book's start date, ${formatDay(book.startDate, "long")}.`}
      />
      <div className="box-content flex max-w-[44rem] flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        {sp.saved === "1" ? (
          <p role="status" className="rounded-xl bg-signal-soft px-4 py-3 text-sm">
            Opening balances saved.{" "}
            {state.entry ? (
              <Link
                href={`${base}/journal/${state.entry.id}`}
                className="font-medium text-signal-ink underline"
              >
                See the journal entry
              </Link>
            ) : null}
          </p>
        ) : null}
        {state.reversedByNumber ? (
          <p className="rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
            The opening balance entry was reversed by {formatEntryNumber(state.reversedByNumber)},
            so these amounts are shown for reference only.
          </p>
        ) : (
          <p className="max-w-prose text-ink-muted">
            Enter what each account held on the start date, using the amount on your statement.
            Saving creates one journal entry; saving again records a new version of it. To use a
            different start date, change it in{" "}
            <Link href={`${base}/settings`} className="underline">
              Book settings
            </Link>
            .
          </p>
        )}
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
