"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { HoldButton } from "@/components/ui/hold-button";
import { formatDay } from "@/lib/dates";
import { formatEntryNumber } from "@/lib/ledger-math";
import { formatCents } from "@/lib/money";
import type { RecItem } from "@/server/reconcile/service";
import { discardAction, finishAction, setClearedAction, undoAction } from "../actions";

/**
 * Check off what cleared on the statement. The difference updates as you go,
 * and Finish unlocks at zero. Amounts read the way the statement does: a
 * card's purchases add to what you owe.
 */
export function RecWorkspace({
  bookId,
  rec,
  liability,
  items,
  canEdit,
  canUndo,
}: {
  bookId: string;
  rec: {
    id: string;
    status: string;
    beginningCents: number;
    statementCents: number;
    finishedAt: string | null;
  };
  liability: boolean;
  items: RecItem[];
  canEdit: boolean;
  canUndo: boolean;
}) {
  const router = useRouter();
  const sign = liability ? -1 : 1;
  const open = rec.status === "open" && canEdit;
  const [cleared, setCleared] = useState(
    () => new Set(items.filter((i) => i.cleared).map((i) => i.entryId)),
  );
  const [pending, start] = useTransition();
  const clearedCents = useMemo(
    () =>
      rec.beginningCents +
      items.filter((i) => cleared.has(i.entryId)).reduce((n, i) => n + i.amountCents, 0),
    [cleared, items, rec.beginningCents],
  );
  const difference = rec.statementCents - clearedCents;
  const base = `/books/${bookId}/reconcile`;

  const toggle = (ids: string[], on: boolean) => {
    setCleared((s) => {
      const n = new Set(s);
      for (const id of ids)
        if (on) n.add(id);
        else n.delete(id);
      return n;
    });
    start(async () => {
      const r = await setClearedAction(bookId, rec.id, ids, on);
      if (!r.ok) toast.error(r.error);
    });
  };

  const allOn = items.length > 0 && items.every((i) => cleared.has(i.entryId));

  return (
    <div className="flex flex-col gap-4">
      <div className="sticky top-0 z-10 flex flex-col gap-3 border-b border-rule-strong bg-paper py-3 sm:flex-row sm:items-center">
        <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-ink-muted">Beginning balance</dt>
            <dd>
              <Money cents={sign * rec.beginningCents} className="font-medium" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Cleared balance</dt>
            <dd>
              <Money cents={sign * clearedCents} className="font-medium" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Statement ending balance</dt>
            <dd>
              <Money cents={sign * rec.statementCents} className="font-medium" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink-muted">Difference</dt>
            <dd
              aria-live="polite"
              className={
                difference === 0 ? "font-semibold text-positive" : "font-semibold text-ink"
              }
            >
              {formatCents(Math.abs(difference))}
              <span className="block text-xs font-normal">
                {difference === 0 ? "Matches the statement." : "Keep checking off items."}
              </span>
            </dd>
          </div>
        </dl>
        {open ? (
          <Button
            variant="primary"
            disabled={difference !== 0 || pending}
            onClick={() =>
              start(async () => {
                const r = await finishAction(bookId, rec.id);
                if (r.ok) {
                  toast.success("Reconciled.");
                  router.refresh();
                } else toast.error(r.error);
              })
            }
          >
            Finish
          </Button>
        ) : null}
      </div>

      {rec.status === "finished" ? (
        <p className="rounded-xl bg-signal-soft px-4 py-3 text-sm">
          Finished
          {rec.finishedAt
            ? ` on ${new Date(rec.finishedAt).toLocaleDateString("en-US", { dateStyle: "medium" })}`
            : ""}
          . These {items.length} items cleared on this statement. Editing one of them later asks you
          to confirm first.
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="py-6 text-sm text-ink-muted">
          Nothing on this account up to the statement date.
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
              <th className="w-10 py-2 pr-2 font-medium">
                {open ? (
                  <input
                    type="checkbox"
                    aria-label="Check all"
                    className="size-4 accent-[var(--signal)]"
                    checked={allOn}
                    onChange={() =>
                      toggle(
                        items.map((i) => i.entryId),
                        !allOn,
                      )
                    }
                  />
                ) : (
                  <span className="sr-only">Cleared</span>
                )}
              </th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="hidden py-2 pr-3 font-medium sm:table-cell">No.</th>
              <th className="py-2 pr-3 font-medium">Description</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => {
              const on = cleared.has(i.entryId);
              return (
                <tr
                  key={i.entryId}
                  className={`border-b border-rule ${open ? "cursor-pointer hover:bg-sunken" : ""}`}
                  onClick={(e) => {
                    if (!open || (e.target as HTMLElement).closest("a,input")) return;
                    toggle([i.entryId], !on);
                  }}
                >
                  <td className="py-2.5 pr-2">
                    <input
                      type="checkbox"
                      aria-label={`Cleared: ${i.description}, ${formatCents(sign * i.amountCents)}`}
                      className="size-4 accent-[var(--signal)]"
                      checked={on}
                      disabled={!open}
                      onChange={() => toggle([i.entryId], !on)}
                    />
                  </td>
                  <td className="tabular whitespace-nowrap py-2.5 pr-3 text-ink-muted">
                    {formatDay(i.entryDate)}
                  </td>
                  <td className="hidden py-2.5 pr-3 sm:table-cell">
                    <Link
                      href={`/books/${bookId}/journal/${i.entryId}`}
                      className="tabular text-signal-ink hover:underline"
                    >
                      {formatEntryNumber(i.entryNumber)}
                    </Link>
                  </td>
                  <td className="py-2.5 pr-3">{i.description}</td>
                  <td className="py-2.5 text-right">
                    <Money cents={sign * i.amountCents} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-4">
        {open ? (
          <>
            <Link href={base} className="text-sm text-ink-muted hover:text-ink">
              Save and leave
            </Link>
            <span className="ml-auto">
              <HoldButton
                label="Discard"
                onConfirm={() =>
                  start(async () => {
                    const r = await discardAction(bookId, rec.id);
                    if (r.ok) router.push(base);
                    else toast.error(r.error);
                  })
                }
              />
            </span>
          </>
        ) : (
          <>
            <Link href={base} className="text-sm font-medium text-signal-ink hover:underline">
              All reconciliations
            </Link>
            {canUndo && canEdit ? (
              <span className="ml-auto">
                <HoldButton
                  label="Undo reconciliation"
                  onConfirm={() =>
                    start(async () => {
                      const r = await undoAction(bookId, rec.id);
                      if (r.ok) {
                        toast.success("Reopened. Change what you need and finish again.");
                        router.refresh();
                      } else toast.error(r.error);
                    })
                  }
                />
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
