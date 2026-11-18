"use client";

import { useActionState, useId } from "react";
import type { ActionState } from "@/server/action-state";
import type { TemplateSummary } from "@/server/accounts/templates";
import { Field, FormError, TextInput } from "./ui/field";
import { SubmitButton } from "./ui/submit-button";

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  templates: TemplateSummary[];
  submitLabel: string;
  namePlaceholder?: string;
};

/**
 * Name and starting chart of accounts. Used by setup and "New book". A book
 * starts the day it is created, so there is no start date to pick.
 */
export function BookForm({ action, templates, submitLabel, namePlaceholder }: Props) {
  const [state, formAction] = useActionState(action, {});
  const v = state.values ?? {};
  const groupId = useId();
  const uid = useId();
  const selected = v.template || "household";

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <FormError message={state.field ? undefined : state.error} />

      <Field
        label="Book name"
        htmlFor={`${uid}-book-name`}
        hint="One book per household or business. You can rename it later."
        error={state.field === "name" ? state.error : undefined}
      >
        <TextInput
          id={`${uid}-book-name`}
          name="name"
          required
          maxLength={80}
          defaultValue={v.name}
          placeholder={namePlaceholder ?? "Family"}
          invalid={state.field === "name"}
          autoComplete="off"
        />
      </Field>

      <fieldset className="flex min-w-0 flex-col gap-2">
        <legend id={groupId} className="mb-1.5 text-[0.8125rem] font-medium text-ink">
          Starting chart of accounts
        </legend>
        <div className="flex flex-col gap-2">
          {templates.map((t) => (
            <label
              key={t.id}
              className="group relative flex cursor-pointer gap-3 rounded-xl border border-field-border bg-surface p-4 transition-[border-color,background-color] duration-150 has-[:checked]:border-signal-strong has-[:checked]:bg-signal-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--focus)]"
            >
              <input
                type="radio"
                name="template"
                value={t.id}
                defaultChecked={t.id === selected}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-field-border bg-surface peer-checked:border-signal-strong after:h-2 after:w-2 after:scale-50 after:rounded-full after:bg-signal-strong after:opacity-0 after:transition-[transform,opacity] after:duration-150 peer-checked:after:scale-100 peer-checked:after:opacity-100"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="font-medium text-ink">{t.label}</span>
                  <span className="tabular text-[0.8125rem] text-ink-muted">
                    {t.accountCount} accounts
                  </span>
                </span>
                <span className="text-sm text-ink-muted">{t.description}</span>
                {t.examples.length > 0 ? (
                  <span className="mt-1 truncate text-[0.8125rem] text-ink-muted">
                    Includes {t.examples.join(", ")} and more
                  </span>
                ) : null}
              </span>
            </label>
          ))}
        </div>
        <p className="text-[0.8125rem] text-ink-muted">
          Everything stays editable: rename, add, nest, or archive accounts afterward.
        </p>
      </fieldset>

      <div className="text-[0.8125rem] text-ink-muted">Currency: US dollars (USD)</div>

      <div>
        <SubmitButton pendingLabel="Creating book">{submitLabel}</SubmitButton>
      </div>
    </form>
  );
}
