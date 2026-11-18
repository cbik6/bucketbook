"use client";

import { ChevronLeft, ChevronRight, Copy } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { FormError, inputClass } from "@/components/ui/field";
import { formatCents, parseCents } from "@/lib/money";
import { copyBudgetAction, saveBudgetAction } from "./actions";

type Line = {
  id: string;
  name: string;
  type: string;
  depth: number;
  hasChildren: boolean;
  actualCents: number;
  budgetCents: number | null;
};

const plain = (c: number | null) => (c ? formatCents(c, { showSymbol: false }) : "");

function shift(month: string, by: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return d.toISOString().slice(0, 7);
}

function monthName(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/**
 * Budget amounts are typed on the accounts that take postings; a parent
 * shows the total of its sub-accounts so nothing is counted twice.
 */
export function BudgetEditor({
  bookId,
  month,
  lines,
  canEdit,
}: {
  bookId: string;
  month: string;
  lines: Line[];
  canEdit: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      lines.filter((l) => !l.hasChildren).map((l) => [l.id, plain(l.budgetCents)]),
    ),
  );
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const base = `/books/${bookId}/budget`;

  const cents = (id: string) => {
    try {
      return values[id]?.trim() ? Math.abs(parseCents(values[id]!)) : 0;
    } catch {
      return 0;
    }
  };
  // Parents roll up their children, in the order lines arrive (parents first).
  const rolled = useMemo(() => {
    const out = new Map<string, number>();
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i]!;
      if (!l.hasChildren) {
        out.set(l.id, cents(l.id));
        continue;
      }
      let sum = 0;
      for (let j = i + 1; j < lines.length && lines[j]!.depth > l.depth; j++) {
        if (lines[j]!.depth === l.depth + 1) sum += out.get(lines[j]!.id) ?? 0;
      }
      out.set(l.id, sum);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cents reads values
  }, [lines, values]);

  const section = (type: string, title: string) => {
    const rows = lines.filter((l) => l.type === type);
    const tops = rows.filter((l) => l.depth === 0);
    const budget = tops.reduce((n, l) => n + (rolled.get(l.id) ?? 0), 0);
    const actual = tops.reduce((n, l) => n + l.actualCents, 0);
    return (
      <>
        <tr>
          <th
            colSpan={4}
            scope="colgroup"
            className="pb-1 pt-5 text-left text-[0.8125rem] font-semibold uppercase tracking-[0.04em] text-ink-muted"
          >
            {title}
          </th>
        </tr>
        {rows.map((l) => {
          const b = rolled.get(l.id) ?? 0;
          const left = type === "expense" ? b - l.actualCents : l.actualCents - b;
          return (
            <tr key={l.id} className="border-b border-rule">
              <td
                className={`py-1.5 pr-3 ${l.hasChildren ? "font-medium" : ""}`}
                style={{ paddingLeft: `${l.depth * 1.25}rem` }}
              >
                <label htmlFor={l.hasChildren ? undefined : `budget-${l.id}`}>{l.name}</label>
              </td>
              <td className="py-1.5 pr-3">
                {l.hasChildren ? (
                  <div className="pr-3 text-right">
                    <Money cents={b} blankZero />
                  </div>
                ) : (
                  <input
                    id={`budget-${l.id}`}
                    inputMode="decimal"
                    value={values[l.id] ?? ""}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [l.id]: e.target.value }));
                      setDirty(true);
                    }}
                    className={`${inputClass} tabular h-9 text-right`}
                    autoComplete="off"
                  />
                )}
              </td>
              <td className="py-1.5 pr-3 text-right">
                <Money cents={l.actualCents} blankZero />
              </td>
              <td className="py-1.5 text-right text-[0.8125rem]">
                {b === 0 ? null : left < 0 ? (
                  <span className="text-negative">
                    {formatCents(-left)} {type === "expense" ? "over" : "short"}
                  </span>
                ) : (
                  <span className="text-ink-muted">
                    {formatCents(left)} {type === "expense" ? "left" : "ahead"}
                  </span>
                )}
              </td>
            </tr>
          );
        })}
        <tr className="border-b border-rule-strong font-semibold">
          <td className="py-2.5 pr-3">Total {title.toLowerCase()}</td>
          <td className="py-2.5 pr-6 text-right">
            <Money cents={budget} />
          </td>
          <td className="py-2.5 pr-3 text-right">
            <Money cents={actual} />
          </td>
          <td />
        </tr>
      </>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Link
            href={`${base}?month=${shift(month, -1)}`}
            aria-label="Previous month"
            className="grid size-9 place-items-center rounded-full hover:bg-sunken"
          >
            <ChevronLeft size={18} aria-hidden />
          </Link>
          <h2 className="min-w-40 text-center text-lg font-semibold text-ink">
            {monthName(month)}
          </h2>
          <Link
            href={`${base}?month=${shift(month, 1)}`}
            aria-label="Next month"
            className="grid size-9 place-items-center rounded-full hover:bg-sunken"
          >
            <ChevronRight size={18} aria-hidden />
          </Link>
        </div>
        {canEdit ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const r = await copyBudgetAction(bookId, month);
                  if (r.ok) {
                    toast.success(r.message);
                    setDirty(false);
                  } else toast.error(r.error);
                })
              }
            >
              <Copy size={15} aria-hidden />
              Copy last month
            </Button>
            <Button
              variant="primary"
              disabled={pending || !dirty}
              onClick={() =>
                start(async () => {
                  const r = await saveBudgetAction(bookId, month, values);
                  if (r.ok) {
                    toast.success(r.message);
                    setDirty(false);
                    setError(undefined);
                  } else setError(r.error);
                })
              }
            >
              {pending ? "Saving" : "Save budget"}
            </Button>
          </div>
        ) : null}
      </div>
      <FormError message={error} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-medium">
                Account
              </th>
              <th scope="col" className="w-40 py-2 pr-6 text-right font-medium">
                Budget
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">
                Actual
              </th>
              <th scope="col" className="py-2 text-right font-medium">
                <span className="sr-only">Difference</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {section("income", "Income")}
            {section("expense", "Expenses")}
          </tbody>
        </table>
      </div>
    </div>
  );
}
