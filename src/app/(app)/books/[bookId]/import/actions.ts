"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import type { StatementResult } from "@/lib/pdf-statement";
import { requireBankableAccount } from "@/server/bank/accounts";
import { type CsvPreviewRow, importCsv, previewCsv } from "@/server/bank/csv-service";
import { readPdfStatement } from "@/server/bank/pdf-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import { serverToday } from "@/server/ledger/page-data";

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

/** Reads a statement PDF in memory on this server and returns its rows for the preview. */
export async function readPdfAction(
  bookId: string,
  formData: FormData,
): Promise<{ ok: boolean; error?: string; result?: StatementResult }> {
  try {
    await editor(bookId);
    const accountId = String(formData.get("accountId") ?? "");
    const file = formData.get("file");
    if (!accountId) throw new UserFacingError("Choose the account this statement is for.");
    if (!(file instanceof File) || file.size === 0) throw new UserFacingError("Choose a PDF.");
    const account = await requireBankableAccount(getDb(), bookId, accountId);
    const kind = account.type === "liability" ? "liability" : "asset";
    const bytes = new Uint8Array(await file.arrayBuffer());
    return { ok: true, result: await readPdfStatement(bytes, kind, serverToday()) };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}
