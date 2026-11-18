"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { deleteLoan, saveLoan } from "@/server/loans/service";

type Result = { ok: boolean; error?: string; field?: string };

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<unknown>,
): Promise<Result> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    await fn({ userId: user.id });
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true };
  } catch (err) {
    const s = actionError(err);
    return { ok: false, error: s.error, field: s.field };
  }
}

export async function saveLoanAction(bookId: string, loanId: string | null, input: unknown) {
  return run(bookId, (actor) => saveLoan(getDb(), actor, bookId, loanId, input));
}

export async function deleteLoanAction(bookId: string, loanId: string) {
  return run(bookId, (actor) => deleteLoan(getDb(), actor, bookId, loanId));
}
