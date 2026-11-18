"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { type CsvPreviewRow, importCsv, previewCsv } from "@/server/bank/csv-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";

async function editor(bookId: string) {
  const user = await requireUser();
  await requireBookAccess(getDb(), user.id, bookId, "editor");
  return { userId: user.id };
}

export async function previewCsvAction(
  bookId: string,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; rows?: CsvPreviewRow[] }> {
  try {
    await editor(bookId);
    return { ok: true, rows: await previewCsv(getDb(), bookId, payload) };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}

export async function importCsvAction(
  bookId: string,
  payload: unknown,
): Promise<{ ok: boolean; error?: string; count?: number; skipped?: number }> {
  try {
    const actor = await editor(bookId);
    const r = await importCsv(getDb(), actor, bookId, payload);
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true, count: r.count, skipped: r.skipped };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}
