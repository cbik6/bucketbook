"use server";

import { redirect } from "next/navigation";
import { type ActionState, actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import { editEntry, postEntry, reverseEntry } from "@/server/ledger/service";

async function editor(bookId: string) {
  const user = await requireUser();
  await requireBookAccess(getDb(), user.id, bookId, "editor");
  return { userId: user.id };
}

function readPayload(formData: FormData): unknown {
  try {
    return JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    throw new UserFacingError("The entry couldn't be read. Reload the page and try again.");
  }
}

export async function saveEntryAction(
  bookId: string,
  entryId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: string;
  try {
    const actor = await editor(bookId);
    const payload = readPayload(formData);
    if (entryId) {
      await editEntry(getDb(), actor, bookId, entryId, payload);
      target = entryId;
    } else {
      const entry = await postEntry(getDb(), actor, bookId, payload);
      target = entry.id;
    }
  } catch (err) {
    return actionError(err);
  }
  const another = formData.get("intent") === "another";
  redirect(
    another
      ? `/books/${bookId}/journal/new?posted=${target}`
      : `/books/${bookId}/journal/${target}?saved=1`,
  );
}

export async function reverseEntryAction(
  bookId: string,
  entryId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let reversalId: string;
  try {
    const actor = await editor(bookId);
    const reversal = await reverseEntry(getDb(), actor, bookId, entryId, {
      entryDate: String(formData.get("entryDate") ?? ""),
      memo: String(formData.get("memo") ?? "") || undefined,
      confirmReconciled: formData.get("confirmReconciled") === "on",
    });
    reversalId = reversal.id;
  } catch (err) {
    return actionError(err);
  }
  redirect(`/books/${bookId}/journal/${reversalId}?saved=1`);
}
