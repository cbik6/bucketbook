"use client";

import { Check, Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { Field, FormError, SelectInput, TextInput, inputClass } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { FillLine } from "@/components/ui/fill-line";
import type { AccountOptionGroup } from "@/lib/account-options";
import { todayIso } from "@/lib/dates";
import { type DraftLine, isBlankLine, parseDraftLines } from "@/lib/ledger-math";
import { formatCents } from "@/lib/money";
import type { ActionState } from "@/server/action-state";

type Line = DraftLine & { key: number };

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  groups: AccountOptionGroup[];
  initial?: { entryDate: string; payee?: string | null; memo: string | null; lines: DraftLine[] };
  defaultDate: string;
  minDate: string;
  cancelHref: string;
  mode: "new" | "edit";
  /** Set when the entry is in a finished reconciliation: asks for a confirming tick. */
  reconciledNote?: string;
};

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, accountId: "", debit: "", credit: "", memo: "" });
const plain = (cents: number) => formatCents(cents, { showSymbol: false });

/** Keeps exactly one empty line at the end, so there's always somewhere to type. */
function withSpare(ls: Line[]): Line[] {
  const last = ls[ls.length - 1];
  return last && isBlankLine(last) ? ls : [...ls, blank()];
}

export function EntryForm({
  action,
  groups,
  initial,
  defaultDate,
  minDate,
  cancelHref,
  mode,
  reconciledNote,
}: Props) {
  const [confirmReconciled, setConfirmReconciled] = useState(false);
  const [state, formAction, pending] = useActionState(action, {});
  // Unique per form: a hidden, previously visited page can still be in the DOM.
  const uid = useId();
  const [entryDate, setEntryDate] = useState(initial?.entryDate ?? defaultDate);
  const [dateTouched, setDateTouched] = useState(Boolean(initial));
  const [payee, setPayee] = useState(initial?.payee ?? "");
  const [memo, setMemo] = useState(initial?.memo ?? "");
  const [lines, setLines] = useState<Line[]>(() => {
    const start = (initial?.lines ?? []).map((l) => ({ ...l, key: nextKey++ }));
    while (start.length < 2) start.push(blank());
    return withSpare(start);
  });
  const formRef = useRef<HTMLFormElement>(null);
  const focusLine = useRef<number | null>(null);

  // A new entry defaults to today in the viewer's own time zone.
  useEffect(() => {
    if (!dateTouched && mode === "new") {
      const local = todayIso();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the server can't know the viewer's time zone
      if (local >= minDate) setEntryDate(local);
    }
  }, [dateTouched, mode, minDate]);

  useEffect(() => {
    if (focusLine.current !== null) {
      document.getElementById(`${uid}-line-${focusLine.current}-account`)?.focus();
      focusLine.current = null;
    }
  });

  const totals = useMemo(() => parseDraftLines(lines), [lines]);
  const difference = totals.debitTotal - totals.creditTotal;
  const filled = lines.filter((l) => !isBlankLine(l)).length;
  const balanced = difference === 0 && totals.debitTotal > 0 && filled >= 2;

  const update = (key: number, patch: Partial<DraftLine>) =>
    setLines((ls) =>
      withSpare(
        ls.map((l) => {
          if (l.key !== key) return l;
          const next = { ...l, ...patch };
          // A line is a debit or a credit: typing in one side clears the other.
          if (patch.debit !== undefined && patch.debit.trim()) next.credit = "";
          if (patch.credit !== undefined && patch.credit.trim()) next.debit = "";
          return next;
        }),
      ),
    );

  const chooseAccount = (key: number, accountId: string) =>
    setLines((ls) => {
      const others = parseDraftLines(ls.filter((l) => l.key !== key));
      const diff = others.debitTotal - others.creditTotal;
      return withSpare(
        ls.map((l) => {
          if (l.key !== key) return l;
          const next = { ...l, accountId };
          // Fill in whatever balances the entry, the way a ledger clerk would.
          if (accountId && !l.debit.trim() && !l.credit.trim() && diff !== 0) {
            if (diff > 0) next.credit = plain(diff);
            else next.debit = plain(-diff);
          }
          return next;
        }),
      );
    });

  const addLine = () => {
    const l = blank();
    focusLine.current = l.key;
    setLines((ls) => [...ls, l]);
  };

  const removeLine = (key: number) =>
    setLines((ls) =>
      withSpare(
        ls.length <= 2
          ? ls.map((l) => (l.key === key ? blank() : l))
          : ls.filter((l) => l.key !== key),
      ),
    );

  const payload = JSON.stringify({
    entryDate,
    payee,
    memo,
    confirmReconciled,
    lines: lines.map(({ accountId, debit, credit, memo: m }) => ({
      accountId,
      debit,
      credit,
      memo: m,
    })),
  });

  return (
    <form
      ref={formRef}
      action={formAction}
      className="flex flex-col gap-6"
      noValidate
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          formRef.current?.requestSubmit();
        }
      }}
    >
      <input type="hidden" name="payload" value={payload} />
      <FormError message={state.field === "entryDate" ? undefined : state.error} />
      {reconciledNote ? (
        <label className="flex items-start gap-2 rounded-xl border border-rule bg-sunken px-4 py-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 accent-[var(--signal)]"
            checked={confirmReconciled}
            onChange={(e) => setConfirmReconciled(e.target.checked)}
          />
          <span>
            {reconciledNote} I understand that saving changes a balance that already matched the
            bank.
          </span>
        </label>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_minmax(0,1fr)]">
        <Field
          label="Date"
          htmlFor={`${uid}-date`}
          error={state.field === "entryDate" ? state.error : undefined}
        >
          <TextInput
            id={`${uid}-date`}
            type="date"
            value={entryDate}
            min={minDate}
            onChange={(e) => {
              setDateTouched(true);
              setEntryDate(e.target.value);
            }}
            className="tabular"
            invalid={state.field === "entryDate"}
            required
          />
        </Field>
        <Field label="Payee" htmlFor={`${uid}-payee`} optional>
          <TextInput
            id={`${uid}-payee`}
            value={payee}
            maxLength={200}
            onChange={(e) => setPayee(e.target.value)}
            placeholder="Who was paid, or who paid you"
            autoComplete="off"
          />
        </Field>
        <Field label="Memo" htmlFor={`${uid}-memo`} optional>
          <TextInput
            id={`${uid}-memo`}
            value={memo}
            maxLength={500}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What this entry is for"
            autoComplete="off"
          />
        </Field>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-2 text-[0.8125rem] font-medium text-ink">Lines</legend>
        <div
          aria-hidden
          className="hidden grid-cols-[minmax(0,1.5fr)_8.5rem_8.5rem_minmax(0,1fr)_2.25rem] gap-2 border-b border-rule pb-2 text-xs font-medium text-ink-muted sm:grid"
        >
          <span>Account</span>
          <span className="pr-3 text-right">Debit</span>
          <span className="pr-3 text-right">Credit</span>
          <span className="pl-3">Line memo</span>
          <span />
        </div>
        <ol className="flex flex-col">
          {lines.map((l, i) => {
            const last = i === lines.length - 1;
            const onEnter = (e: React.KeyboardEvent) => {
              if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
                e.preventDefault();
                if (last) addLine();
                else document.getElementById(`${uid}-line-${lines[i + 1]!.key}-account`)?.focus();
              }
            };
            return (
              <li
                key={l.key}
                className="grid grid-cols-2 gap-2 border-b border-rule py-3 sm:grid-cols-[minmax(0,1.5fr)_8.5rem_8.5rem_minmax(0,1fr)_2.25rem] sm:items-center sm:py-2"
              >
                <div className="col-span-2 flex items-center gap-2 sm:col-span-1">
                  <span className="tabular w-5 shrink-0 text-xs text-ink-faint sm:hidden">
                    {i + 1}
                  </span>
                  <SelectInput
                    id={`${uid}-line-${l.key}-account`}
                    aria-label={`Line ${i + 1} account`}
                    value={l.accountId}
                    onChange={(e) => chooseAccount(l.key, e.target.value)}
                    className="min-w-0"
                  >
                    <option value="">Choose an account</option>
                    {groups.map((g) => (
                      <optgroup key={g.type} label={g.label}>
                        {g.options.map((o) => (
                          <option
                            key={o.id}
                            value={o.id}
                            disabled={o.disabled && o.id !== l.accountId}
                          >
                            {o.code ? `${o.code} ` : ""}
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </SelectInput>
                  <button
                    type="button"
                    onClick={() => removeLine(l.key)}
                    aria-label={`Remove line ${i + 1}`}
                    title="Remove line"
                    className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-[background-color,transform] duration-150 hover:bg-sunken hover:text-ink active:scale-[0.95] sm:hidden"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <AmountInput
                  id={`${uid}-line-${l.key}-debit`}
                  label={`Line ${i + 1} debit`}
                  placeholder="Debit"
                  value={l.debit}
                  onChange={(v) => update(l.key, { debit: v })}
                  onKeyDown={onEnter}
                />
                <AmountInput
                  id={`${uid}-line-${l.key}-credit`}
                  label={`Line ${i + 1} credit`}
                  placeholder="Credit"
                  value={l.credit}
                  onChange={(v) => update(l.key, { credit: v })}
                  onKeyDown={onEnter}
                />
                <TextInput
                  id={`${uid}-line-${l.key}-memo`}
                  aria-label={`Line ${i + 1} memo`}
                  placeholder="Line memo"
                  value={l.memo}
                  maxLength={500}
                  onChange={(e) => update(l.key, { memo: e.target.value })}
                  onKeyDown={onEnter}
                  className="col-span-2 sm:col-span-1"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={() => removeLine(l.key)}
                  aria-label={`Remove line ${i + 1}`}
                  title="Remove line"
                  className="hidden h-9 w-9 items-center justify-center rounded-lg text-ink-muted transition-[background-color,transform] duration-150 hover:bg-sunken hover:text-ink active:scale-[0.95] sm:flex"
                >
                  <X size={16} aria-hidden />
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-3 flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1.5fr)_8.5rem_8.5rem_minmax(0,1fr)_2.25rem] sm:items-start sm:gap-2">
          <button
            type="button"
            onClick={addLine}
            className={buttonClass("ghost", "sm", "self-start justify-self-start")}
          >
            <Plus size={15} aria-hidden />
            Add line
          </button>
          <div className="flex justify-between text-sm sm:contents">
            <span className="text-ink-muted sm:hidden">Debits</span>
            <span className="tabular text-right font-semibold sm:pr-3">
              {formatCents(totals.debitTotal)}
            </span>
          </div>
          <div className="flex justify-between text-sm sm:contents">
            <span className="text-ink-muted sm:hidden">Credits</span>
            <span className="tabular text-right font-semibold sm:pr-3">
              {formatCents(totals.creditTotal)}
            </span>
          </div>
          <div className="flex flex-col gap-1.5 text-sm sm:col-span-2">
            {Math.max(totals.debitTotal, totals.creditTotal) > 0 ? (
              <FillLine
                value={Math.min(totals.debitTotal, totals.creditTotal)}
                max={Math.max(totals.debitTotal, totals.creditTotal)}
                label="Credits compared with debits"
                instant
                className="mt-1.5 max-w-48"
              />
            ) : null}
            <div aria-live="polite">
              {balanced ? (
                <span className="inline-flex items-center gap-1.5 font-medium text-positive">
                  <Check size={15} aria-hidden /> Balanced
                </span>
              ) : difference !== 0 ? (
                <span className="font-medium text-negative">
                  Out of balance by{" "}
                  <span className="tabular">{formatCents(Math.abs(difference))}</span>
                </span>
              ) : (
                <span className="text-ink-muted">Enter at least two lines.</span>
              )}
            </div>
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-rule pt-5">
        <button
          type="submit"
          aria-disabled={pending}
          className={buttonClass("primary")}
          onClick={(e) => pending && e.preventDefault()}
        >
          {pending ? "Saving" : mode === "new" ? "Post entry" : "Save new version"}
        </button>
        {mode === "new" ? (
          <button
            type="submit"
            name="intent"
            value="another"
            aria-disabled={pending}
            className={buttonClass("secondary")}
            onClick={(e) => pending && e.preventDefault()}
          >
            Post and start another
          </button>
        ) : null}
        <Link href={cancelHref} className={buttonClass("ghost")}>
          Cancel
        </Link>
        <span className="hidden text-xs text-ink-muted sm:inline">
          <kbd className="rounded border border-rule-strong px-1 font-sans">Ctrl</kbd>+
          <kbd className="rounded border border-rule-strong px-1 font-sans">Enter</kbd> posts.{" "}
          <kbd className="rounded border border-rule-strong px-1 font-sans">Enter</kbd> on the last
          line adds one.
        </span>
      </div>
    </form>
  );
}

function AmountInput({
  id,
  label,
  placeholder,
  value,
  onChange,
  onKeyDown,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
    <input
      id={id}
      aria-label={label}
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      className={`${inputClass} tabular text-right placeholder:text-left sm:placeholder:text-transparent`}
    />
  );
}
