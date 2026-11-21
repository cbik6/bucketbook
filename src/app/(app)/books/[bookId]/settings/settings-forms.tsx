"use client";

import { useActionState, useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FormError, SelectInput, TextInput } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { SYNC_FREQUENCY_OPTIONS, describeSync, hourLabel } from "@/lib/bank-sync";
import {
  deleteBookAction,
  renameBookAction,
  setBankSyncAction,
  setBookArchivedAction,
} from "../../actions";

export function RenameBookForm({ bookId, name }: { bookId: string; name: string }) {
  const [state, formAction] = useActionState(renameBookAction.bind(null, bookId), {});
  const uid = useId();
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4" noValidate>
      <Field
        label="Book name"
        htmlFor={`${uid}-rename-book`}
        error={state.error}
        hint={state.success ? <span className="text-positive">{state.success}</span> : undefined}
      >
        <TextInput
          id={`${uid}-rename-book`}
          name="name"
          defaultValue={state.values?.name ?? name}
          maxLength={80}
          required
          invalid={Boolean(state.error)}
        />
      </Field>
      <div>
        <SubmitButton variant="secondary" pendingLabel="Saving">
          Save name
        </SubmitButton>
      </div>
    </form>
  );
}

/** How often the book's bank connections sync, and from what hour. Owners change it. */
export function BankSyncForm({
  bookId,
  everyHours,
  hour,
  timeZone,
  canEdit,
}: {
  bookId: string;
  everyHours: number;
  hour: number;
  timeZone: string;
  canEdit: boolean;
}) {
  const uid = useId();
  const [every, setEvery] = useState(everyHours);
  const [start, setStart] = useState(hour);
  const [pending, startTransition] = useTransition();
  const changed = every !== everyHours || start !== hour;
  const summary = every
    ? `Syncs ${describeSync(every, start)} (${timeZone}).`
    : "Syncs only when someone presses Sync now on the Bank connections page.";

  if (!canEdit) {
    return (
      <p className="text-sm">
        {summary} <span className="text-ink-muted">Only the book owner can change this.</span>
      </p>
    );
  }

  const save = () =>
    startTransition(async () => {
      const r = await setBankSyncAction(bookId, every, start);
      if (r.error) toast.error(r.error);
      else toast.success(r.success ?? "Saved.");
    });

  return (
    <div className="flex max-w-md flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How often" htmlFor={`${uid}-every`}>
          <SelectInput
            id={`${uid}-every`}
            value={every}
            onChange={(e) => setEvery(Number(e.target.value))}
          >
            {SYNC_FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        {every ? (
          <Field label={every === 24 ? "At" : "Starting at"} htmlFor={`${uid}-hour`}>
            <SelectInput
              id={`${uid}-hour`}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                </option>
              ))}
            </SelectInput>
          </Field>
        ) : null}
      </div>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {summary}
      </p>
      <div>
        <Button
          variant="secondary"
          disabled={!changed}
          pending={pending}
          pendingLabel="Saving"
          onClick={save}
        >
          Save sync schedule
        </Button>
      </div>
    </div>
  );
}

export function ArchiveBookControl({ bookId, archived }: { bookId: string; archived: boolean }) {
  const [pending, startTransition] = useTransition();
  const run = (archive: boolean) =>
    startTransition(async () => {
      const result = await setBookArchivedAction(bookId, archive);
      if (result.error) toast.error(result.error);
      else
        toast.success(archive ? "Book archived" : "Book restored", {
          action: archive ? { label: "Undo", onClick: () => run(false) } : undefined,
        });
    });

  return archived ? (
    <Button variant="secondary" disabled={pending} onClick={() => run(false)}>
      Restore book
    </Button>
  ) : (
    <HoldButton
      label="Archive book"
      holdingLabel="Keep holding to archive"
      disabled={pending}
      onConfirm={() => run(true)}
      size="md"
    />
  );
}

/**
 * Permanent removal of an archived book. Two deliberate steps: type the book's
 * name, then hold the button.
 */
export function DeleteBookControl({ bookId, name }: { bookId: string; name: string }) {
  const uid = useId();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const matches = typed.trim() === name;
  return (
    <div className="flex max-w-md flex-col gap-4">
      <FormError message={error} />
      <Field label={`Type ${name} to confirm`} htmlFor={`${uid}-confirm`}>
        <TextInput
          id={`${uid}-confirm`}
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div>
        <HoldButton
          label="Delete book forever"
          holdingLabel="Keep holding to delete"
          size="md"
          disabled={!matches || pending}
          onConfirm={() =>
            startTransition(async () => {
              const result = await deleteBookAction(bookId, typed);
              if (result?.error) setError(result.error);
            })
          }
        />
      </div>
    </div>
  );
}
