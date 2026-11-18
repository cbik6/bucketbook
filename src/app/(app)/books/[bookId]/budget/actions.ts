"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { copyPreviousMonth, saveBudget } from "@/server/reports/budget-service";

type Result = { ok: boolean; error?: string; field?: string; message?: string };

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<string>,
): Promise<Result> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    const message = await fn({ userId: user.id });
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true, message };
  } catch (err) {
    const s = actionError(err);
    return { ok: false, error: s.error, field: s.field };
  }
}

export async function saveBudgetAction(
  bookId: string,
  month: string,
  amounts: Record<string, string>,
) {
  return run(bookId, async (actor) => {
    await saveBudget(getDb(), actor, bookId, month, amounts);
    return "Budget saved.";
  });
}

export async function copyBudgetAction(bookId: string, month: string) {
  return run(bookId, async (actor) => {
    const n = await copyPreviousMonth(getDb(), actor, bookId, month);
    return `Copied ${n} amounts from last month.`;
  });
}
