"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { createPayee, mergePayees, removePayeeMatch, updatePayee } from "@/server/payees/service";

export type PayeeResult = { ok: boolean; error?: string; field?: string; message?: string };

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<string | void>,
): Promise<PayeeResult> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    const message = await fn({ userId: user.id });
    // Payee names show across the book: review, registers, the journal, reports.
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true, message: message || undefined };
  } catch (err) {
    const s = actionError(err);
    return { ok: false, error: s.error, field: s.field };
  }
}

export async function createPayeeAction(bookId: string, payload: unknown) {
  return run(bookId, async (actor) => {
    const p = await createPayee(getDb(), actor, bookId, payload);
    return `Added ${p.name}.`;
  });
}

export async function updatePayeeAction(bookId: string, payeeId: string, payload: unknown) {
  return run(bookId, async (actor) => {
    await updatePayee(getDb(), actor, bookId, payeeId, payload);
  });
}

export async function mergePayeesAction(bookId: string, fromId: string, intoId: string) {
  return run(bookId, async (actor) => {
    const r = await mergePayees(getDb(), actor, bookId, fromId, intoId);
    return `Merged. ${r.entries === 1 ? "1 entry moved" : `${r.entries} entries moved`}.`;
  });
}

export async function removePayeeMatchAction(bookId: string, payeeId: string, key: string) {
  return run(bookId, async (actor) => {
    await removePayeeMatch(getDb(), actor, bookId, payeeId, key);
  });
}
