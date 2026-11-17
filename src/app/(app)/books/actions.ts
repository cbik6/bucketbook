"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { createBook, renameBook, setBookArchived } from "@/server/books/service";
import { getDb } from "@/server/db/client";

export async function createBookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name", "template", "startDate"]);
  let bookId: string;
  try {
    const user = await requireUser();
    const { book } = await createBook(getDb(), { userId: user.id }, values);
    bookId = book.id;
  } catch (err) {
    return actionError(err, values);
  }
  redirect(`/books/${bookId}/accounts`);
}

export async function renameBookAction(
  bookId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name"]);
  try {
    const user = await requireUser();
    const book = await renameBook(getDb(), { userId: user.id }, bookId, values.name);
    refresh();
    return { success: `Renamed to ${book.name}.`, values: { name: book.name } };
  } catch (err) {
    return actionError(err, values);
  }
}

export async function setBookArchivedAction(
  bookId: string,
  archive: boolean,
): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    await setBookArchived(getDb(), { userId: user.id }, bookId, archive);
    refresh();
    return {};
  } catch (err) {
    return { error: actionError(err).error };
  }
}
