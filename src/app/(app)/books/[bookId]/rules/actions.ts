"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { createRule, deleteRule, moveRule, updateRule } from "@/server/bank/rules-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";

export type RuleResult = { ok: boolean; error?: string; field?: string };

async function run(bookId: string, fn: (actor: { userId: string }) => Promise<unknown>) {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    await fn({ userId: user.id });
    // Suggestions in review change with the rules, and the nav shows its count.
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true };
  } catch (err) {
    const s = actionError(err);
    return { ok: false, error: s.error, field: s.field };
  }
}

export async function saveRuleAction(
  bookId: string,
  ruleId: string | null,
  payload: unknown,
): Promise<RuleResult> {
  return run(bookId, (actor) =>
    ruleId
      ? updateRule(getDb(), actor, bookId, ruleId, payload)
      : createRule(getDb(), actor, bookId, payload),
  );
}

export async function deleteRuleAction(bookId: string, ruleId: string): Promise<RuleResult> {
  return run(bookId, (actor) => deleteRule(getDb(), actor, bookId, ruleId));
}

export async function moveRuleAction(
  bookId: string,
  ruleId: string,
  direction: "up" | "down",
): Promise<RuleResult> {
  return run(bookId, (actor) => moveRule(getDb(), actor, bookId, ruleId, direction));
}
