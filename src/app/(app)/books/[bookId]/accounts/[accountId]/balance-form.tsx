"use client";

import { Scale } from "lucide-react";
import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { AccountSelectOptions } from "@/components/account-select-options";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import type { AccountOptionGroup } from "@/lib/account-options";
import { recordBalanceAction } from "../actions";

/**
 * For accounts no bank reports, such as cash or a car's value: type what it
 * is worth now, and the difference posts against an account you choose.
 */
export function BalanceForm({
  bookId,
  accountId,
  accountName,
  groups,
  today,
  defaultOffsetId,
}: {
  /** Pre-selected account for the difference (for investments, unrealized gains). */
  defaultOffsetId?: string;
  bookId: string;
  accountId: string;
  accountName: string;
  groups: AccountOptionGroup[];
  today: string;
}) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [date, setDate] = useState(today);
  const [balance, setBalance] = useState("");
  const [offset, setOffset] = useState(defaultOffsetId ?? "");
  if (!open) {
    return (
      <Button variant="ghost" onClick={() => setOpen(true)}>
        <Scale size={15} aria-hidden />
        Record a new balance
      </Button>
    );
  }
  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-rule bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await recordBalanceAction(bookId, accountId, {
            date,
            balance,
            offsetAccountId: offset,
          });
          if (r.ok) {
            toast.success("Balance recorded.");
            setOpen(false);
            setBalance("");
          } else setError(r.error);
        });
      }}
    >
      <p className="text-sm text-ink">
        For things no bank reports, like cash or a car&apos;s value. Enter what {accountName} is
        worth (or owes) on a date; the difference posts against the account you pick.
      </p>
      <FormError message={error} />
      <div className="grid gap-3 sm:grid-cols-[10rem_10rem_minmax(0,1fr)]">
        <Field label="Date" htmlFor={`${uid}-date`}>
          <TextInput
            id={`${uid}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="tabular"
          />
        </Field>
        <Field label="New balance" htmlFor={`${uid}-bal`}>
          <TextInput
            id={`${uid}-bal`}
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="tabular text-right"
            autoFocus
          />
        </Field>
        <Field
          label="Difference goes to"
          htmlFor={`${uid}-off`}
          hint="For example a gain or loss account, or Opening Balance Equity."
        >
          <SelectInput id={`${uid}-off`} value={offset} onChange={(e) => setOffset(e.target.value)}>
            <option value="">Choose an account</option>
            <AccountSelectOptions groups={groups} value={offset} exclude={accountId} />
          </SelectInput>
        </Field>
      </div>
      <div className="flex gap-2">
        <Button type="submit" variant="primary" pending={pending} pendingLabel="Saving">
          Record balance
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
