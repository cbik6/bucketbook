"use client";

import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormError, TextInput } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { todayIso } from "@/lib/dates";
import type { ActionState } from "@/server/action-state";

/**
 * Reversal is offered inline, not in a dialog: open it, pick the date the
 * correction should land on, post.
 */
export function ReverseForm({
  action,
  entryLabel,
  minDate,
  notes = [],
}: {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  entryLabel: string;
  minDate: string;
  /** Consequences worth knowing first, such as bank transactions going back to review. */
  notes?: string[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, {});
  const [date, setDate] = useState<string>("");
  const dateId = useId();

  if (!open) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          const today = todayIso();
          setDate(today < minDate ? minDate : today);
          setOpen(true);
        }}
      >
        Reverse
      </Button>
    );
  }

  return (
    <form
      action={formAction}
      className="flex w-full flex-col gap-4 rounded-xl border border-rule bg-sunken p-4"
      noValidate
    >
      <p className="text-sm">
        Posts a new entry with every debit and credit swapped, cancelling {entryLabel} as of the
        date you pick. The original stays in the journal.
      </p>
      {notes.map((n) => (
        <p key={n} className="text-sm font-medium">
          {n}
        </p>
      ))}
      <FormError message={state.field ? undefined : state.error} />
      <Field
        label="Reversal date"
        htmlFor={dateId}
        error={state.field === "entryDate" ? state.error : undefined}
      >
        <TextInput
          id={dateId}
          name="entryDate"
          type="date"
          min={minDate}
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="tabular max-w-48"
          invalid={state.field === "entryDate"}
          required
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton pendingLabel="Posting reversal">Post reversal</SubmitButton>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
