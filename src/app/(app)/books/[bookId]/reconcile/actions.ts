"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import {
  discardReconciliation,
  finishReconciliation,
  setCleared,
  startReconciliation,
  undoReconciliation,
} from "@/server/reconcile/service";

async function editor(bookId: string) {
  const user = await requireUser();
  await requireBookAccess(getDb(), user.id, bookId, "editor");
  return { userId: user.id };
}

export async function startAction(
  bookId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["accountId", "statementDate", "statementBalance"]);
  let id: string;
  try {
    const actor = await editor(bookId);
    id = (await startReconciliation(getDb(), actor, bookId, values)).id;
  } catch (err) {
    return actionError(err, values);
  }
  redirect(`/books/${bookId}/reconcile/${id}`);
}

type Result = { ok: boolean; error?: string };

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<unknown>,
): Promise<Result> {
  try {
    const actor = await editor(bookId);
    await fn(actor);
    revalidatePath(`/books/${bookId}/reconcile`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}

export async function setClearedAction(
  bookId: string,
  recId: string,
  entryIds: string[],
  cleared: boolean,
) {
  return run(bookId, () => setCleared(getDb(), bookId, recId, entryIds, cleared));
}

export async function finishAction(bookId: string, recId: string) {
  return run(bookId, (actor) => finishReconciliation(getDb(), actor, bookId, recId));
}

export async function discardAction(bookId: string, recId: string) {
  return run(bookId, (actor) => discardReconciliation(getDb(), actor, bookId, recId));
}

export async function undoAction(bookId: string, recId: string) {
  return run(bookId, (actor) => undoReconciliation(getDb(), actor, bookId, recId));
}
