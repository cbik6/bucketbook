"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import {
  createBook,
  deleteBook,
  renameBook,
  setBankSync,
  setBookArchived,
} from "@/server/books/service";
import { describeSync } from "@/lib/bank-sync";
import { getDb } from "@/server/db/client";
import { syncSchedules } from "@/server/jobs/simplefin";
import { serverToday } from "@/server/ledger/page-data";
import { createDemoBook } from "@/server/demo/seed";
import { todayIso } from "@/lib/dates";

export async function createBookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name", "template"]);
  let bookId: string;
  try {
    const user = await requireUser();
    const { book } = await createBook(
      getDb(),
      { userId: user.id },
      { ...values, startDate: serverToday() },
    );
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

export async function setBankSyncAction(
  bookId: string,
  everyHours: number,
  hour: number,
): Promise<ActionState> {
  try {
    const user = await requireUser();
    const book = await setBankSync(getDb(), { userId: user.id }, bookId, { everyHours, hour });
    await syncSchedules().catch((err: Error) =>
      console.error("[jobs] schedule update failed:", err.message),
    );
    refresh();
    return {
      success: `Bank accounts sync ${describeSync(book.bankSyncEveryHours, book.bankSyncHour)}.`,
    };
  } catch (err) {
    return actionError(err);
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

/** Permanently deletes an archived book, then returns to the list of books. */
export async function deleteBookAction(
  bookId: string,
  confirmName: string,
): Promise<{ error?: string }> {
  try {
    const user = await requireUser();
    await deleteBook(getDb(), { userId: user.id }, bookId, confirmName);
    // Its bank connections are gone, so their daily syncs go too.
    await syncSchedules().catch((err: Error) =>
      console.error("[jobs] schedule update failed:", err.message),
    );
  } catch (err) {
    return { error: actionError(err).error };
  }
  redirect("/books");
}

/** Creates the sample "Demo Household" book and opens its review queue. */
export async function createDemoBookAction(): Promise<ActionState> {
  let bookId: string;
  try {
    const user = await requireUser();
    ({ bookId } = await createDemoBook(
      getDb(),
      { userId: user.id },
      todayIso(process.env.TZ || undefined),
    ));
  } catch (err) {
    return actionError(err);
  }
  redirect(`/books/${bookId}/review`);
}
