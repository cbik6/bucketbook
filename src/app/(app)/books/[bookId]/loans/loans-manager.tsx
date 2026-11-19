"use client";

import { Pencil, Plus } from "lucide-react";
import { useId, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Money } from "@/components/money";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import { formatDay } from "@/lib/dates";
import { amortize, formatRate, levelPayment, parseRate } from "@/lib/loans";
import { formatCents, parseCents } from "@/lib/money";
import type { LoanView } from "@/server/loans/service";
import { deleteLoanAction, saveLoanAction } from "./actions";

type Option = { id: string; label: string; subtype: string };

export function LoansManager({
  bookId,
  loans,
  liabilities,
  expenses,
  today,
  canEdit,
}: {
  bookId: string;
  loans: LoanView[];
  liabilities: Option[];
  expenses: Option[];
  today: string;
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState<string | "new" | null>(null);
  return (
    <div className="flex flex-col gap-8">
      {canEdit && editing !== "new" ? (
        <div>
          <Button variant="primary" onClick={() => setEditing("new")}>
            <Plus size={16} aria-hidden />
            New loan
          </Button>
        </div>
      ) : null}
      {editing === "new" ? (
        <LoanForm
          bookId={bookId}
          liabilities={liabilities}
          expenses={expenses}
          today={today}
          onDone={() => setEditing(null)}
        />
      ) : null}
      {loans.length === 0 && editing !== "new" ? (
        <p className="max-w-prose text-sm text-ink-muted">
          No loans yet. Add one for a mortgage, car loan or student loan: pick its liability account
          and enter the terms from your loan papers.
        </p>
      ) : null}
      {loans.map((l) =>
        editing === l.id ? (
          <LoanForm
            key={l.id}
            bookId={bookId}
            loan={l}
            liabilities={liabilities}
            expenses={expenses}
            today={today}
            onDone={() => setEditing(null)}
          />
        ) : (
          <LoanCard
            key={l.id}
            loan={l}
            today={today}
            canEdit={canEdit}
            onEdit={() => setEditing(l.id)}
          />
        ),
      )}
    </div>
  );
}

function LoanCard({
  loan,
  today,
  canEdit,
  onEdit,
}: {
  loan: LoanView;
  today: string;
  canEdit: boolean;
  onEdit: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const schedule = useMemo(
    () =>
      amortize({
        principalCents: loan.principalCents,
        rateMicro: loan.annualRateMicro,
        months: loan.termMonths,
        paymentCents: loan.paymentCents,
        firstPaymentDate: loan.firstPaymentDate,
      }),
    [loan],
  );
  const past = schedule.filter((r) => r.date <= today);
  const scheduled = past.at(-1)?.balanceCents ?? loan.principalCents;
  const next = schedule.find((r) => r.date > today);
  const totalInterest = schedule.reduce((n, r) => n + r.interestCents, 0);
  const shown = showAll ? schedule : schedule.filter((r) => r.date > today).slice(0, 6);
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-rule p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">{loan.accountName}</h2>
          <p className="text-sm text-ink-muted">
            {formatCents(loan.principalCents)} at {formatRate(loan.annualRateMicro)} for{" "}
            {loan.termMonths} months, {formatCents(loan.paymentCents)} a month. Interest goes to{" "}
            {loan.interestAccountName}.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" variant="secondary" onClick={onEdit}>
            <Pencil size={13} aria-hidden />
            Edit
          </Button>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-ink-muted">Owed, per the books</dt>
          <dd>
            <Money cents={loan.owedCents} className="font-semibold" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Owed, per the schedule</dt>
          <dd>
            <Money cents={scheduled} className="font-semibold" />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Next payment</dt>
          <dd>
            {next ? `${formatCents(next.paymentCents)} on ${formatDay(next.date)}` : "Paid off"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-muted">Total interest</dt>
          <dd>
            <Money cents={totalInterest} />
          </dd>
        </div>
      </dl>
      {loan.owedCents !== scheduled ? (
        <p className="rounded-lg bg-sunken px-3 py-2 text-[0.8125rem] text-ink">
          The books and the schedule differ by {formatCents(Math.abs(loan.owedCents - scheduled))}.
          That is normal with extra payments or before opening balances are entered.
        </p>
      ) : null}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] text-sm">
          <caption className="mb-2 text-left text-[0.8125rem] font-medium text-ink">
            {showAll ? "Full schedule" : "Upcoming payments"}
          </caption>
          <thead>
            <tr className="border-b border-rule-strong text-left text-xs text-ink-muted">
              <th className="py-2 pr-3 font-medium">No.</th>
              <th className="py-2 pr-3 font-medium">Date</th>
              <th className="py-2 pr-3 text-right font-medium">Payment</th>
              <th className="py-2 pr-3 text-right font-medium">Interest</th>
              <th className="py-2 pr-3 text-right font-medium">Principal</th>
              <th className="py-2 text-right font-medium">Balance</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.number}
                className={`border-b border-rule ${r.date <= today ? "text-ink-muted" : ""}`}
              >
                <td className="tabular py-2 pr-3">{r.number}</td>
                <td className="tabular py-2 pr-3">{formatDay(r.date)}</td>
                <td className="py-2 pr-3 text-right">
                  <Money cents={r.paymentCents} />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money cents={r.interestCents} />
                </td>
                <td className="py-2 pr-3 text-right">
                  <Money cents={r.principalCents} />
                </td>
                <td className="py-2 text-right">
                  <Money cents={r.balanceCents} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div>
        <Button size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show upcoming only" : `Show all ${schedule.length} payments`}
        </Button>
      </div>
    </section>
  );
}

function LoanForm({
  bookId,
  loan,
  liabilities,
  expenses,
  today,
  onDone,
}: {
  bookId: string;
  loan?: LoanView;
  liabilities: Option[];
  expenses: Option[];
  today: string;
  onDone: () => void;
}) {
  const uid = useId();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [accountId, setAccountId] = useState(
    loan?.accountId ??
      liabilities.find((l) => l.subtype === "loan")?.id ??
      liabilities[0]?.id ??
      "",
  );
  const [interestAccountId, setInterest] = useState(
    loan?.interestAccountId ?? expenses.find((e) => /interest/i.test(e.label))?.id ?? "",
  );
  const [principal, setPrincipal] = useState(
    loan ? formatCents(loan.principalCents, { showSymbol: false }) : "",
  );
  const [rate, setRate] = useState(loan ? formatRate(loan.annualRateMicro).replace("%", "") : "");
  const [term, setTerm] = useState(loan ? String(loan.termMonths) : "60");
  const [first, setFirst] = useState(loan?.firstPaymentDate ?? today);
  const [payment, setPayment] = useState(
    loan ? formatCents(loan.paymentCents, { showSymbol: false }) : "",
  );

  let suggested: number | null = null;
  try {
    const p = parseCents(principal);
    const r = parseRate(rate);
    const n = Number(term);
    if (p > 0 && r !== null && Number.isInteger(n) && n > 0) suggested = levelPayment(p, r, n);
  } catch {
    suggested = null;
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4 sm:p-5"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await saveLoanAction(bookId, loan?.id ?? null, {
            accountId,
            interestAccountId,
            principal,
            rate,
            termMonths: term,
            firstPaymentDate: first,
            payment,
          });
          if (r.ok) {
            toast.success(loan ? "Loan saved." : "Loan added.");
            onDone();
          } else setError(r.error);
        });
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone();
      }}
    >
      <h2 className="text-[0.9375rem] font-semibold text-ink">{loan ? "Edit loan" : "New loan"}</h2>
      <FormError message={error} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Loan account"
          htmlFor={`${uid}-acct`}
          hint="A liability account, such as Car Loan."
        >
          <SelectInput
            id={`${uid}-acct`}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Choose an account</option>
            {liabilities.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          label="Interest goes to"
          htmlFor={`${uid}-int`}
          hint="An expense account, such as Interest Paid."
        >
          <SelectInput
            id={`${uid}-int`}
            value={interestAccountId}
            onChange={(e) => setInterest(e.target.value)}
          >
            <option value="">Choose an account</option>
            {expenses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <Field label="Amount borrowed" htmlFor={`${uid}-p`}>
          <TextInput
            id={`${uid}-p`}
            inputMode="decimal"
            value={principal}
            onChange={(e) => setPrincipal(e.target.value)}
            className="tabular text-right"
          />
        </Field>
        <Field label="Rate (% a year)" htmlFor={`${uid}-r`}>
          <TextInput
            id={`${uid}-r`}
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            className="tabular text-right"
            placeholder="6.5"
          />
        </Field>
        <Field label="Term (months)" htmlFor={`${uid}-n`}>
          <TextInput
            id={`${uid}-n`}
            inputMode="numeric"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            className="tabular text-right"
          />
        </Field>
        <Field label="First payment" htmlFor={`${uid}-d`}>
          <TextInput
            id={`${uid}-d`}
            type="date"
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            className="tabular"
          />
        </Field>
        <Field
          label="Monthly payment"
          htmlFor={`${uid}-pay`}
          optional
          hint={suggested ? `Standard: ${formatCents(suggested)}` : undefined}
        >
          <TextInput
            id={`${uid}-pay`}
            inputMode="decimal"
            value={payment}
            onChange={(e) => setPayment(e.target.value)}
            className="tabular text-right"
            placeholder={suggested ? formatCents(suggested, { showSymbol: false }) : ""}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving">
          {loan ? "Save loan" : "Add loan"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {loan ? (
          <span className="ml-auto">
            <HoldButton
              label="Remove loan"
              onConfirm={() =>
                start(async () => {
                  const r = await deleteLoanAction(bookId, loan.id);
                  if (r.ok) {
                    toast.success("Loan removed. Its account and entries are unchanged.");
                    onDone();
                  } else setError(r.error);
                })
              }
            />
          </span>
        ) : null}
      </div>
    </form>
  );
}
