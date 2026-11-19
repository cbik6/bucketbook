"use client";

import { useId, useState, useTransition } from "react";
import { toast } from "sonner";
import { SelectInput } from "@/components/ui/field";
import { setPostToParentsAction } from "./actions";

/**
 * Whether accounts with sub-accounts can be picked. "Headings only" keeps
 * everything on the sub-accounts, the way most charts of accounts work.
 */
export function ParentPosting({
  bookId,
  allowed,
  canEdit,
}: {
  bookId: string;
  allowed: boolean;
  canEdit: boolean;
}) {
  const id = useId();
  const [pending, start] = useTransition();
  // Shows the new choice at once; goes back if saving fails.
  const [value, setValue] = useState(allowed);
  return (
    <div className="flex items-center gap-2 text-sm" aria-busy={pending || undefined}>
      <label htmlFor={id} className="whitespace-nowrap text-ink-muted">
        Parent accounts
      </label>
      <SelectInput
        compact
        id={id}
        value={value ? "allowed" : "headings"}
        disabled={!canEdit || pending}
        onChange={(e) => {
          const next = e.target.value === "allowed";
          setValue(next);
          start(async () => {
            const r = await setPostToParentsAction(bookId, next);
            if (!r.ok) {
              setValue(!next);
              toast.error(r.error);
            } else
              toast.success(
                next
                  ? "Parent accounts can be chosen again."
                  : "Parent accounts are now headings only. Pick one of their sub-accounts instead.",
              );
          });
        }}
      >
        <option value="allowed">Can be chosen</option>
        <option value="headings">Headings only</option>
      </SelectInput>
    </div>
  );
}
