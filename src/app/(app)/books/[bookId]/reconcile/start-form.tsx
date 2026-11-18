"use client";

import { useActionState, useId, useState } from "react";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDay } from "@/lib/dates";
import { startAction } from "./actions";

export function StartForm({
  bookId,
  today,
  accounts,
}: {
  bookId: string;
  today: string;
  accounts: { id: string; name: string; lastReconciled: string | null }[];
}) {
  const uid = useId();
  const [state, formAction] = useActionState(startAction.bind(null, bookId), {});
  const v = state.values;
  const [accountId, setAccountId] = useState(v?.accountId ?? accounts[0]?.id ?? "");
  const last = accounts.find((a) => a.id === accountId)?.lastReconciled;
  return (
    <form
      action={formAction}
      className="flex flex-col gap-4 rounded-xl border border-rule p-4 sm:p-5"
      noValidate
    >
      <h2 className="text-[0.9375rem] font-semibold text-ink">Start a reconciliation</h2>
      <FormError message={state.field ? undefined : state.error} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Account"
          htmlFor={`${uid}-account`}
          hint={last ? `Reconciled through ${formatDay(last)}` : "Never reconciled"}
          error={state.field === "accountId" ? state.error : undefined}
        >
          <SelectInput
            id={`${uid}-account`}
            name="accountId"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field
          label="Statement ending date"
          htmlFor={`${uid}-date`}
          error={state.field === "statementDate" ? state.error : undefined}
        >
          <TextInput
            id={`${uid}-date`}
            name="statementDate"
            type="date"
            defaultValue={v?.statementDate ?? today}
            className="tabular"
            invalid={state.field === "statementDate"}
          />
        </Field>
        <Field
          label="Ending balance"
          htmlFor={`${uid}-balance`}
          hint="As printed on the statement. For a card, what you owe."
          error={state.field === "statementBalance" ? state.error : undefined}
        >
          <TextInput
            id={`${uid}-balance`}
            name="statementBalance"
            inputMode="decimal"
            defaultValue={v?.statementBalance}
            className="tabular text-right"
            invalid={state.field === "statementBalance"}
            autoComplete="off"
          />
        </Field>
      </div>
      <div>
        <SubmitButton pendingLabel="Starting">Start</SubmitButton>
      </div>
    </form>
  );
}
