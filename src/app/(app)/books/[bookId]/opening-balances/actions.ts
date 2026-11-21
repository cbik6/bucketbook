"use server";

import { redirect } from "next/navigation";
import { type ActionState, actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { saveOpeningBalances } from "@/server/ledger/service";

export async function saveOpeningBalancesAction(
  bookId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const amounts: Record<string, string> = {};
  const dates: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("amt-")) amounts[key.slice(4)] = String(value);
    if (key.startsWith("asof-")) dates[key.slice(5)] = String(value);
  }
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    await saveOpeningBalances(getDb(), { userId: user.id }, bookId, amounts, dates);
  } catch (err) {
    const values = { ...amounts };
    for (const [id, date] of Object.entries(dates)) values[`asof-${id}`] = date;
    return actionError(err, values);
  }
  redirect(`/books/${bookId}/opening-balances?saved=1`);
}
