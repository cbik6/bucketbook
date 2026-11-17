"use client";

import { useActionState, useMemo, useState } from "react";
import { FormError, inputClass } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { AccountType } from "@/lib/account-types";
import { formatCents, parseCents } from "@/lib/money";
import type { ActionState } from "@/server/action-state";

export type OpeningRow = {
  id: string;
  name: string;
  code: string | null;
  type: AccountType;
  depth: number;
  initial: string;
};

export type OpeningGroup = { type: AccountType; label: string; hint: string; rows: OpeningRow[] };

function safeCents(text: string): number | null {
  if (!text.trim()) return 0;
  try {
    return parseCents(text);
  } catch {
    return null;
  }
}

export function OpeningForm({
  action,
  groups,
  readOnly,
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  groups: OpeningGroup[];
  readOnly: boolean;
}) {
  const [state, formAction] = useActionState(action, {});
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      groups.flatMap((g) => g.rows.map((r) => [r.id, state.values?.[r.id] ?? r.initial])),
    ),
  );

  const summary = useMemo(() => {
    const sums: Record<AccountType, number> = {
      asset: 0,
      liability: 0,
      equity: 0,
      income: 0,
      expense: 0,
    };
    let bad = false;
    for (const g of groups) {
      for (const r of g.rows) {
        const c = safeCents(values[r.id] ?? "");
        if (c === null) bad = true;
        else sums[r.type] += c;
      }
    }
    // What's left over is your starting net worth, recorded as Opening Balance Equity.
    const obe = sums.asset - sums.liability - sums.equity;
    return { asset: sums.asset, liability: sums.liability, otherEquity: sums.equity, obe, bad };
  }, [values, groups]);

  return (
    <form action={formAction} className="flex flex-col gap-8" noValidate>
      <FormError message={state.error} />
      {groups.map((g) => (
        <fieldset key={g.type} className="min-w-0" disabled={readOnly}>
          <legend className="text-[0.9375rem] font-semibold">{g.label}</legend>
          <p className="mb-2 mt-0.5 text-[0.8125rem] text-ink-muted">{g.hint}</p>
          <div className="flex flex-col">
            {g.rows.map((r) => {
              const invalid = safeCents(values[r.id] ?? "") === null || state.field === r.id;
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between gap-4 border-b border-rule py-2"
                  style={{ paddingLeft: `${r.depth * 1.25}rem` }}
                >
                  <label htmlFor={`ob-${r.id}`} className="min-w-0 truncate">
                    {r.code ? (
                      <span className="mr-2 font-mono text-[0.8125rem] text-ink-muted">
                        {r.code}
                      </span>
                    ) : null}
                    {r.name}
                  </label>
                  <div className="w-36 shrink-0">
                    <input
                      id={`ob-${r.id}`}
                      name={`amt-${r.id}`}
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={values[r.id] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [r.id]: e.target.value }))}
                      aria-invalid={invalid || undefined}
                      className={`${inputClass} tabular text-right`}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}

      <div
        aria-live="polite"
        className="flex flex-col gap-1 rounded-xl bg-sunken px-4 py-3 text-sm"
      >
        {summary.bad ? (
          <span className="text-negative">One of the amounts isn&apos;t a valid number yet.</span>
        ) : (
          <>
            <div className="flex justify-between gap-4">
              <span>What you own</span>
              <span className="tabular">{formatCents(summary.asset)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span>What you owe</span>
              <span className="tabular">{formatCents(summary.liability)}</span>
            </div>
            {summary.otherEquity !== 0 ? (
              <div className="flex justify-between gap-4">
                <span>Other equity you entered</span>
                <span className="tabular">{formatCents(summary.otherEquity)}</span>
              </div>
            ) : null}
            <div className="mt-1 flex justify-between gap-4 border-t border-rule-strong pt-2 font-semibold">
              <span>Opening Balance Equity</span>
              <span className="tabular">{formatCents(summary.obe)}</span>
            </div>
            <p className="text-[0.8125rem] text-ink-muted">
              The difference is your starting net worth. It goes to Opening Balance Equity so the
              entry balances.
            </p>
          </>
        )}
      </div>

      {readOnly ? null : (
        <div>
          <SubmitButton pendingLabel="Saving">Save opening balances</SubmitButton>
        </div>
      )}
    </form>
  );
}
