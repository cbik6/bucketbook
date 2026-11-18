"use client";

import { useActionState, useId, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, TextInput } from "@/components/ui/field";
import { HoldButton } from "@/components/ui/hold-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { renameBookAction, setBookArchivedAction } from "../../actions";

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
