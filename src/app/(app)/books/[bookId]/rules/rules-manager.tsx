"use client";

import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountSelectOptions } from "@/components/account-select-options";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import type { AccountOptionGroup } from "@/lib/account-options";
import { formatCents, parseCents } from "@/lib/money";
import { DIRECTIONS, TEXT_FIELDS, TEXT_OPS, TEXT_OP_LABELS, describeConditions } from "@/lib/rules";
import type { RuleRow } from "@/server/bank/rules-service";
import { deleteRuleAction, moveRuleAction, saveRuleAction } from "./actions";

type BankAccount = { id: string; name: string };

const FIELD_LABELS: Record<(typeof TEXT_FIELDS)[number], string> = {
  any: "Payee or description",
  payee: "Payee",
  description: "Description",
};

const DIRECTION_LABELS: Record<(typeof DIRECTIONS)[number], string> = {
  any: "Money in or out",
  outflow: "Money out",
  inflow: "Money in",
};

export function RulesManager({
  bookId,
  rules,
  groups,
  bankAccounts,
  buckets,
  canEdit,
}: {
  bookId: string;
  rules: RuleRow[];
  groups: AccountOptionGroup[];
  bankAccounts: BankAccount[];
  buckets: { id: string; label: string }[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [pending, start] = useTransition();
  const names = new Map<string, string>();
  for (const g of groups) for (const o of g.options) names.set(o.id, o.label);
  const accountName = (id: string) => names.get(id) ?? "a removed account";

  const thenText = (r: RuleRow) => {
    const parts: string[] = [];
    if (r.actions.transfer) parts.push("treat as a transfer");
    if (r.actions.offsetAccountId) parts.push(`category ${accountName(r.actions.offsetAccountId)}`);
    if (r.actions.bucketAccountId) {
      parts.push(
        `bucket ${buckets.find((b) => b.id === r.actions.bucketAccountId)?.label ?? "removed"}`,
      );
    }
    if (r.actions.payee) parts.push(`payee "${r.actions.payee}"`);
    if (r.actions.memo) parts.push(`memo "${r.actions.memo}"`);
    return parts.join(", ");
  };

  const move = (id: string, direction: "up" | "down") =>
    start(async () => {
      const r = await moveRuleAction(bookId, id, direction);
      if (!r.ok) toast.error(r.error);
    });

  return (
    <div className="flex flex-col gap-6">
      {canEdit && editing !== "new" ? (
        <div>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden />
            New rule
          </Button>
        </div>
      ) : null}
      {editing === "new" ? (
        <RuleEditor
          bookId={bookId}
          groups={groups}
          bankAccounts={bankAccounts}
          buckets={buckets}
          onDone={() => setEditing(null)}
        />
      ) : null}

      {rules.length === 0 ? (
        <div className="flex max-w-prose flex-col gap-2 text-sm text-ink-muted">
          <p>No rules yet.</p>
          <p>
            The quickest way to make one: in For review, open a transaction&apos;s details and tick
            &ldquo;Always use this category&rdquo; when you approve it.
          </p>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-[0.8125rem] text-ink-muted">
            Rules are tried from the top. For each field, the first matching rule that sets it wins.
          </p>
          <ol className="flex flex-col border-t border-rule-strong">
            {rules.map((r, i) =>
              editing === r.id ? (
                <li key={r.id} className="border-b border-rule py-3">
                  <RuleEditor
                    bookId={bookId}
                    rule={r}
                    groups={groups}
                    bankAccounts={bankAccounts}
                    buckets={buckets}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={r.id}
                  className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-2 gap-y-2 border-b border-rule py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center"
                >
                  <span className="tabular pt-0.5 text-sm text-ink-faint">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{r.name}</span>
                      {!r.enabled ? (
                        <span className="rounded bg-sunken px-1.5 py-px text-xs text-ink-muted">
                          Off
                        </span>
                      ) : null}
                    </div>
                    <p className="text-[0.8125rem] text-ink-muted">
                      When{" "}
                      {describeConditions(
                        r.conditions,
                        (id) => bankAccounts.find((a) => a.id === id)?.name ?? "an account",
                      )}
                      : {thenText(r)}
                    </p>
                  </div>
                  {canEdit ? (
                    <div className="col-start-2 flex items-center gap-1 sm:col-start-auto">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${r.name} up`}
                        title="Move up"
                        disabled={i === 0 || pending}
                        onClick={() => move(r.id, "up")}
                      >
                        <ArrowUp size={14} aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${r.name} down`}
                        title="Move down"
                        disabled={i === rules.length - 1 || pending}
                        onClick={() => move(r.id, "down")}
                      >
                        <ArrowDown size={14} aria-hidden />
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(r.id)}>
                        <Pencil size={13} aria-hidden />
                        Edit
                      </Button>
                    </div>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        </div>
      )}
    </div>
  );
}

const centsText = (c: number | null | undefined) =>
  c == null ? "" : formatCents(c, { showSymbol: false });

function RuleEditor({
  bookId,
  rule,
  groups,
  bankAccounts,
  buckets,
  onDone,
}: {
  bookId: string;
  rule?: RuleRow;
  groups: AccountOptionGroup[];
  bankAccounts: BankAccount[];
  buckets: { id: string; label: string }[];
  onDone: () => void;
}) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const c = rule?.conditions;
  const a = rule?.actions;
  const [name, setName] = useState(rule?.name ?? "");
  const [field, setField] = useState<string>(c?.text?.field ?? "any");
  const [op, setOp] = useState<string>(c?.text?.op ?? "contains");
  const [value, setValue] = useState(c?.text?.value ?? "");
  const [direction, setDirection] = useState<string>(c?.direction ?? "any");
  const [min, setMin] = useState(centsText(c?.amount?.minCents));
  const [max, setMax] = useState(centsText(c?.amount?.maxCents));
  const [accountId, setAccountId] = useState(c?.accountId ?? "");
  const [offset, setOffset] = useState(a?.offsetAccountId ?? "");
  const [bucket, setBucket] = useState(a?.bucketAccountId ?? "");
  const [payee, setPayee] = useState(a?.payee ?? "");
  const [memo, setMemo] = useState(a?.memo ?? "");
  const [transfer, setTransfer] = useState(a?.transfer ?? false);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  const amount = (text: string, label: string) => {
    if (!text.trim()) return null;
    const cents = Math.abs(parseCents(text));
    if (!Number.isSafeInteger(cents)) throw new Error(label);
    return cents;
  };

  const save = () => {
    let minCents: number | null;
    let maxCents: number | null;
    try {
      minCents = amount(min, "lowest");
      maxCents = amount(max, "highest");
    } catch {
      setError("Enter amounts like 12.50.");
      return;
    }
    const payload = {
      name: name.trim() || value.trim(),
      enabled,
      conditions: {
        text: value.trim() ? { field, op, value: value.trim() } : null,
        amount: minCents != null || maxCents != null ? { minCents, maxCents } : null,
        direction,
        accountId: accountId || null,
      },
      actions: {
        offsetAccountId: offset || null,
        bucketAccountId: bucket || null,
        payee: payee.trim() || null,
        memo: memo.trim() || null,
        transfer,
      },
    };
    start(async () => {
      const r = await saveRuleAction(bookId, rule?.id ?? null, payload);
      if (r.ok) {
        toast.success(
          rule ? "Rule saved." : "Rule created. Suggestions in For review are updated.",
        );
        onDone();
      } else setError(r.error);
    });
  };

  const remove = () =>
    start(async () => {
      if (!rule) return;
      const r = await deleteRuleAction(bookId, rule.id);
      if (r.ok) {
        toast.success("Rule deleted.");
        onDone();
      } else setError(r.error);
    });

  return (
    <form
      className="flex flex-col gap-5 rounded-xl border border-rule bg-surface p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
      noValidate
    >
      <h2 className="text-[0.9375rem] font-semibold text-ink">
        {rule ? `Edit ${rule.name}` : "New rule"}
      </h2>
      <FormError message={error} />
      <Field label="Name" htmlFor={`${uid}-name`} hint="Leave blank to use the text it looks for.">
        <TextInput
          id={`${uid}-name`}
          value={name}
          maxLength={100}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          autoFocus
        />
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold text-ink">When</legend>
        <div className="grid gap-2 sm:grid-cols-[13rem_10rem_minmax(0,1fr)]">
          <SelectInput
            aria-label="Look in"
            value={field}
            onChange={(e) => setField(e.target.value)}
          >
            {TEXT_FIELDS.map((f) => (
              <option key={f} value={f}>
                {FIELD_LABELS[f]}
              </option>
            ))}
          </SelectInput>
          <SelectInput aria-label="How to match" value={op} onChange={(e) => setOp(e.target.value)}>
            {TEXT_OPS.map((o) => (
              <option key={o} value={o}>
                {TEXT_OP_LABELS[o]}
              </option>
            ))}
          </SelectInput>
          <TextInput
            aria-label="Text to look for"
            value={value}
            maxLength={200}
            onChange={(e) => setValue(e.target.value)}
            placeholder={op === "regex" ? "^(shell|chevron)" : "For example: costco"}
            autoComplete="off"
            className={op === "regex" ? "font-mono" : ""}
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-[13rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)]">
          <SelectInput
            aria-label="Direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {DIRECTION_LABELS[d]}
              </option>
            ))}
          </SelectInput>
          <TextInput
            aria-label="Amount at least"
            placeholder="At least"
            inputMode="decimal"
            value={min}
            onChange={(e) => setMin(e.target.value)}
            className="tabular"
          />
          <TextInput
            aria-label="Amount at most"
            placeholder="At most"
            inputMode="decimal"
            value={max}
            onChange={(e) => setMax(e.target.value)}
            className="tabular"
          />
          <SelectInput
            aria-label="On account"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">On any account</option>
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>
                On {b.name}
              </option>
            ))}
          </SelectInput>
        </div>
        <p className="text-[0.8125rem] text-ink-muted">
          At least and at most compare the size of the amount, whether money goes in or out.
        </p>
      </fieldset>

      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-[0.8125rem] font-semibold text-ink">Then suggest</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category" htmlFor={`${uid}-offset`} optional>
            <SelectInput
              id={`${uid}-offset`}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            >
              <option value="">No category</option>
              <AccountSelectOptions groups={groups} value={offset} />
            </SelectInput>
          </Field>
          {buckets.length ? (
            <Field label="Bucket" htmlFor={`${uid}-bucket`} optional>
              <SelectInput
                id={`${uid}-bucket`}
                value={bucket}
                onChange={(e) => setBucket(e.target.value)}
              >
                <option value="">No bucket</option>
                {buckets.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </SelectInput>
            </Field>
          ) : null}
          <Field label="Rename payee to" htmlFor={`${uid}-payee`} optional>
            <TextInput
              id={`${uid}-payee`}
              value={payee}
              maxLength={200}
              onChange={(e) => setPayee(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field label="Memo" htmlFor={`${uid}-memo`} optional>
            <TextInput
              id={`${uid}-memo`}
              value={memo}
              maxLength={500}
              onChange={(e) => setMemo(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <label className="flex items-start gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-[var(--signal)]"
              checked={transfer}
              onChange={(e) => setTransfer(e.target.checked)}
            />
            <span>
              Money moving between your own accounts
              <span className="block text-[0.8125rem] text-ink-muted">
                Bucketbook looks for the matching transaction instead of a category.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="size-4 accent-[var(--signal)]"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Rule is on
      </label>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule pt-4">
        <Button type="submit" variant="primary" disabled={pending}>
          {pending ? "Saving" : rule ? "Save rule" : "Create rule"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {rule ? (
          <span className="ml-auto">
            <HoldButton label="Delete rule" onConfirm={remove} disabled={pending} />
          </span>
        ) : null}
      </div>
    </form>
  );
}
