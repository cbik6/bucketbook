"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  archiveAccount,
  createAccount,
  deleteAccount,
  unarchiveAccount,
  updateAccount,
} from "@/server/accounts/service";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";

const FIELDS = ["name", "code", "type", "subtype", "parentAccountId", "description"];

async function editorContext(bookId: string) {
  const user = await requireUser();
  await requireBookAccess(getDb(), user.id, bookId, "editor");
  return { userId: user.id };
}

export async function saveAccountAction(
  bookId: string,
  accountId: string | null,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, FIELDS);
  let savedId: string;
  try {
    const actor = await editorContext(bookId);
    const row = accountId
      ? await updateAccount(getDb(), actor, bookId, accountId, values)
      : await createAccount(getDb(), actor, bookId, values);
    savedId = row.id;
  } catch (err) {
    return actionError(err, values);
  }
  redirect(`/books/${bookId}/accounts?saved=${savedId}`);
}

export type QuickResult = { error?: string; name?: string };

async function quick(
  bookId: string,
  run: (actor: { userId: string }) => Promise<{ name: string } | void>,
): Promise<QuickResult> {
  try {
    const actor = await editorContext(bookId);
    const row = await run(actor);
    refresh();
    return { name: row?.name };
  } catch (err) {
    return { error: actionError(err).error };
  }
}

export async function archiveAccountAction(bookId: string, accountId: string) {
  return quick(bookId, (actor) => archiveAccount(getDb(), actor, bookId, accountId));
}

export async function unarchiveAccountAction(bookId: string, accountId: string) {
  return quick(bookId, (actor) => unarchiveAccount(getDb(), actor, bookId, accountId));
}

export async function deleteAccountAction(bookId: string, accountId: string) {
  return quick(bookId, (actor) => deleteAccount(getDb(), actor, bookId, accountId));
}
