import { Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/app-shell";
import { Money } from "@/components/money";
import { RangePicker } from "@/components/range-picker";
import { ButtonLink } from "@/components/ui/button";
import { accountPath, descendantIds } from "@/lib/account-tree";
import { type AccountType, NORMAL_BALANCE, subtypeLabel } from "@/lib/account-types";
import { formatDay, resolveRange } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { listAccounts } from "@/server/accounts/service";
import { getDb } from "@/server/db/client";
import { loadBookForPage } from "@/server/guards";
import { accountRegister } from "@/server/ledger/queries";
import { serverToday } from "@/server/ledger/page-data";

export const metadata: Metadata = { title: "Account register" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);

async function RegisterContent({
  params,
  searchParams,
}: PageProps<"/books/[bookId]/accounts/[accountId]">) {
  await connection();
  const { bookId, accountId } = await params;
  const sp = await searchParams;
  const { book } = await loadBookForPage(bookId);
  const rows = await listAccounts(getDb(), book.id);
  const account = rows.find((a) => a.id === accountId);
  if (!account) notFound();

  const type = account.type as AccountType;
  const children = descendantIds(rows, account.id);
  const includeSubs = children.size > 0 && one(sp.subs) !== "0";
  const ids = includeSubs ? [account.id, ...children] : [account.id];
  const range = resolveRange(
    { range: one(sp.range), from: one(sp.from), to: one(sp.to) },
    serverToday(),
    "all",
  );
  const { openingNetCents, rows: lines } = await accountRegister(getDb(), book.id, ids, range);
  const nat = (net: number) => (NORMAL_BALANCE[type] === "debit" ? net : -net);
  const ending = lines.length ? lines[lines.length - 1]!.runningNetCents : openingNetCents;
  const base = `/books/${book.id}`;
  const path = accountPath(rows, account.id);
  const names = new Map(rows.map((r) => [r.id, r.name]));
  const keep = { subs: children.size > 0 && !includeSubs ? "0" : undefined };

  return (
    <>
      <PageHeader
        title={account.name}
        maxWidthClass="max-w-[64rem]"
        description={
          <>
            {path.length > 1 ? `${path.slice(0, -1).join(" : ")} : ` : ""}
            {subtypeLabel(type, account.subtype)}
            {account.code ? <span className="ml-2 font-mono">{account.code}</span> : null}
          </>
        }
        actions={
          book.role !== "viewer" ? (
            <ButtonLink href={`${base}/accounts?edit=${account.id}`} variant="secondary">
              <Pencil size={15} aria-hidden />
              Edit account
            </ButtonLink>
          ) : null
        }
      />
      <div className="flex max-w-[64rem] flex-col gap-5 px-5 pb-16 pt-6 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[0.8125rem] text-ink-muted">
              Balance{range.to ? ` on ${formatDay(range.to)}` : ""}
            </div>
            <div className="text-[1.75rem] font-semibold tracking-[-0.02em]">
              <Money cents={nat(ending)} />
            </div>
          </div>
          {children.size > 0 ? (
            <Link
              href={`${base}/accounts/${account.id}?${new URLSearchParams({
                ...(range.preset === "custom"
                  ? { from: range.from ?? "", to: range.to ?? "" }
                  : { range: range.preset }),
                subs: includeSubs ? "0" : "1",
              })}`}
              className="text-sm font-medium text-signal-ink underline"
              aria-pressed={includeSubs}
            >
              {includeSubs ? "Show this account only" : "Include sub-accounts"}
            </Link>
          ) : null}
        </div>

        <RangePicker basePath={`${base}/accounts/${account.id}`} range={range} keep={keep} />

        {lines.length === 0 && openingNetCents === 0 ? (
          <p className="py-6 text-ink-muted">
            No transactions {range.preset === "all" ? "yet" : "in this date range"}.{" "}
            {book.role !== "viewer" ? (
              <Link href={`${base}/journal/new`} className="font-medium text-signal-ink underline">
                Post a journal entry
              </Link>
            ) : null}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    No.
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Description
                  </th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">
                    Debit
                  </th>
                  <th scope="col" className="w-28 py-2 pr-3 text-right font-medium">
                    Credit
                  </th>
                  <th scope="col" className="w-32 py-2 text-right font-medium">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {range.from ? (
                  <tr className="border-b border-rule text-ink-muted">
                    <td className="tabular py-2.5 pr-3">{formatDay(range.from)}</td>
                    <td className="py-2.5 pr-3" />
                    <td className="py-2.5 pr-3 italic">Balance forward</td>
                    <td className="py-2.5 pr-3" />
                    <td className="py-2.5 pr-3" />
                    <td className="py-2.5 text-right">
                      <Money cents={nat(openingNetCents)} />
                    </td>
                  </tr>
                ) : null}
                {lines.map((r) => (
                  <tr key={r.lineId} className="border-b border-rule hover:bg-sunken/70">
                    <td className="tabular whitespace-nowrap py-2.5 pr-3 text-ink-muted">
                      {formatDay(r.entryDate)}
                    </td>
                    <td className="tabular whitespace-nowrap py-2.5 pr-3">
                      <Link
                        href={`${base}/journal/${r.entryId}`}
                        className="text-signal-ink hover:underline"
                      >
                        {formatEntryNumber(r.entryNumber)}
                      </Link>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="text-ink">{r.lineMemo || r.entryMemo || "No memo"}</div>
                      <div className="text-[0.8125rem] text-ink-muted">
                        {includeSubs && r.accountId !== account.id
                          ? `${names.get(r.accountId)} · `
                          : ""}
                        {r.otherAccounts.length > 1
                          ? `Split: ${r.otherAccounts.join(", ")}`
                          : (r.otherAccounts[0] ?? "")}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Money cents={r.debitCents} blankZero />
                    </td>
                    <td className="py-2.5 pr-3 text-right">
                      <Money cents={r.creditCents} blankZero />
                    </td>
                    <td className="py-2.5 text-right">
                      <Money cents={nat(r.runningNetCents)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

export default function RegisterPage(props: PageProps<"/books/[bookId]/accounts/[accountId]">) {
  return (
    <Suspense>
      <RegisterContent {...props} />
    </Suspense>
  );
}
