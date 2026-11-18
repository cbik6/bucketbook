import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { buildAccountTree, flattenTree } from "@/lib/account-tree";
import { ACCOUNT_TYPES, type AccountType, NORMAL_BALANCE } from "@/lib/account-types";
import { formatDay, resolveRange } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { listAccounts } from "@/server/accounts/service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { accountTotals, linesInRange } from "@/server/ledger/queries";
import { serverToday } from "@/server/ledger/page-data";

export const metadata: Metadata = { title: "General ledger" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function LedgerContent({ params, searchParams }: PageProps<"/books/[bookId]/ledger">) {
  await connection();
  const { bookId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const range = resolveRange(
    { range: one(sp.range), from: one(sp.from), to: one(sp.to) },
    serverToday(),
    "ytd",
  );
  const [rows, opening, lines] = await Promise.all([
    listAccounts(getDb(), book.id),
    range.from
      ? accountTotals(getDb(), book.id, { before: range.from })
      : Promise.resolve(new Map()),
    linesInRange(getDb(), book.id, range),
  ]);
  const byAccount = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = byAccount.get(l.accountId) ?? [];
    list.push(l);
    byAccount.set(l.accountId, list);
  }
  const tree = buildAccountTree(rows);
  const ordered = ACCOUNT_TYPES.flatMap((t) => flattenTree(tree[t], { includeArchived: true }));
  const sections = ordered
    .map((a) => {
      const o = opening.get(a.id);
      const openingNet = o ? o.debitCents - o.creditCents : 0;
      return { account: a, openingNet, lines: byAccount.get(a.id) ?? [] };
    })
    .filter((s) => s.openingNet !== 0 || s.lines.length > 0);
  const base = `/books/${book.id}`;

  return (
    <>
      <PageHeader
        title="General ledger"
        maxWidthClass="max-w-[64rem]"
        description={`Every posted line, by account. ${range.label}.`}
      />
      <div className="box-content flex max-w-[64rem] flex-col gap-6 px-5 pb-16 pt-6 lg:px-10">
        <RangePicker basePath={`${base}/ledger`} range={range} />
        {sections.length === 0 ? (
          <p className="py-6 text-ink-muted">
            Nothing posted in this date range.{" "}
            <Link href={`${base}/journal/new`} className="font-medium text-signal-ink underline">
              Post a journal entry
            </Link>
          </p>
        ) : (
          sections.map(({ account, openingNet, lines: ls }) => {
            const type = account.type as AccountType;
            const nat = (net: number) => (NORMAL_BALANCE[type] === "debit" ? net : -net);
            let running = openingNet;
            const debits = ls.reduce((n, l) => n + l.debitCents, 0);
            const credits = ls.reduce((n, l) => n + l.creditCents, 0);
            const headingId = `gl-${account.id}`;
            return (
              <section key={account.id} aria-labelledby={headingId} className="overflow-x-auto">
                <h2 id={headingId} className="mb-1 text-[0.9375rem] font-semibold">
                  <Link href={`${base}/accounts/${account.id}`} className="hover:underline">
                    {account.code ? (
                      <span className="mr-2 font-mono text-[0.8125rem] text-ink-muted">
                        {account.code}
                      </span>
                    ) : null}
                    {account.name}
                  </Link>
                </h2>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead className="sr-only">
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">No.</th>
                      <th scope="col">Description</th>
                      <th scope="col">Debit</th>
                      <th scope="col">Credit</th>
                      <th scope="col">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-b border-t border-rule-strong text-ink-muted">
                      <td className="tabular w-28 py-2 pr-3">
                        {range.from ? formatDay(range.from) : ""}
                      </td>
                      <td className="w-20 py-2 pr-3" />
                      <td className="py-2 pr-3 italic">Beginning balance</td>
                      <td className="w-28 py-2 pr-3" />
                      <td className="w-28 py-2 pr-3" />
                      <td className="w-32 py-2 text-right">
                        <Money cents={nat(openingNet)} />
                      </td>
                    </tr>
                    {ls.map((l) => {
                      running += l.debitCents - l.creditCents;
                      return (
                        <tr key={l.lineId} className="border-b border-rule">
                          <td className="tabular whitespace-nowrap py-2 pr-3 text-ink-muted">
                            {formatDay(l.entryDate)}
                          </td>
                          <td className="tabular whitespace-nowrap py-2 pr-3">
                            <Link
                              href={`${base}/journal/${l.entryId}`}
                              className="text-signal-ink hover:underline"
                            >
                              {formatEntryNumber(l.entryNumber)}
                            </Link>
                          </td>
                          <td className="py-2 pr-3">
                            {[l.entryPayee, l.lineMemo || l.entryMemo].filter(Boolean).join(": ")}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Money cents={l.debitCents} blankZero />
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Money cents={l.creditCents} blankZero />
                          </td>
                          <td className="py-2 text-right">
                            <Money cents={nat(running)} />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="font-semibold">
                      <td className="py-2 pr-3" colSpan={3}>
                        Total {account.name}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Money cents={debits} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <Money cents={credits} />
                      </td>
                      <td className="py-2 text-right">
                        <Money cents={nat(running)} />
                      </td>
                    </tr>
                  </tbody>
                </table>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}

export default function LedgerPage(props: PageProps<"/books/[bookId]/ledger">) {
  return (
    <Suspense>
      <LedgerContent {...props} />
    </Suspense>
  );
}
