"use client";

import Link from "next/link";
import { useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import type { QueueItem, QueueTab } from "@/server/bank/review-service";
import { restoreAction } from "./actions";

const METHOD: Record<string, string> = {
  approved: "Approved",
  transfer: "Transfer",
  linked: "Matched",
};

const EMPTY: Record<Exclude<QueueTab, "review">, string> = {
  pending:
    "Nothing pending. Charges the bank hasn't finished posting show up here, and move to For review once they clear.",
  posted: "Nothing approved yet.",
  excluded: "Nothing excluded.",
};

/** Pending, posted and excluded transactions: read-only lists. */
export function SimpleList({
  bookId,
  tab,
  items,
  canEdit,
}: {
  bookId: string;
  tab: Exclude<QueueTab, "review">;
  items: QueueItem[];
  canEdit: boolean;
}) {
  const [pending, start] = useTransition();
  if (items.length === 0) {
    return <p className="max-w-prose py-8 text-sm text-ink-muted">{EMPTY[tab]}</p>;
  }
  return (
    <table className="mt-2 w-full text-sm">
      <thead>
        <tr className="border-b border-rule-strong text-left text-xs font-medium text-ink-muted">
          <th className="py-2 pr-3 font-medium">Date</th>
          <th className="hidden py-2 pr-3 font-medium md:table-cell">Account</th>
          <th className="py-2 pr-3 font-medium">Description</th>
          <th className="py-2 pr-3 text-right font-medium">Amount</th>
          <th className="py-2 font-medium">
            <span className="sr-only">Status</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((i) => (
          <tr key={i.id} className="border-b border-rule align-top hover:bg-sunken/70">
            <td className="tabular whitespace-nowrap py-2.5 pr-3 text-ink-muted">
              {formatDay(i.postedDate)}
            </td>
            <td className="hidden py-2.5 pr-3 text-ink-muted md:table-cell">{i.accountName}</td>
            <td className="py-2.5 pr-3">
              <div className="text-ink">{i.payee ?? i.description}</div>
              {i.payee && i.payee !== i.description ? (
                <div className="text-[0.8125rem] text-ink-muted">{i.description}</div>
              ) : null}
            </td>
            <td className="py-2.5 pr-3 text-right">
              <Money cents={i.amountCents} />
            </td>
            <td className="whitespace-nowrap py-2.5 text-right">
              {tab === "posted" && i.entryId ? (
                <span className="inline-flex items-center gap-2">
                  <span className="rounded bg-sunken px-1.5 py-0.5 text-xs text-ink-muted">
                    {METHOD[i.postMethod ?? ""] ?? "Posted"}
                  </span>
                  <Link
                    href={`/books/${bookId}/journal/${i.entryId}`}
                    className="tabular font-medium text-signal-ink hover:underline"
                  >
                    {i.entryNumber ? formatEntryNumber(i.entryNumber) : "Entry"}
                  </Link>
                </span>
              ) : tab === "excluded" && canEdit ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await restoreAction(bookId, i.id);
                      if (r.ok) toast.success(r.message);
                      else toast.error(r.error);
                    })
                  }
                >
                  Restore
                </Button>
              ) : tab === "pending" ? (
                <span className="text-xs text-ink-muted">Pending</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
