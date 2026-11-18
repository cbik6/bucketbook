"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import {
  type ApproveInput,
  type Decision,
  applyDecisions,
  approveItem,
  approveTransfer,
  excludeItem,
  keepBoth,
  linkToEntry,
  restoreItem,
  undoApproval,
} from "@/server/bank/review-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";

export type ReviewResult = {
  ok: boolean;
  error?: string;
  field?: string;
  message?: string;
  entryId?: string;
};

async function editor(bookId: string) {
  const user = await requireUser();
  await requireBookAccess(getDb(), user.id, bookId, "editor");
  return { userId: user.id };
}

function refresh(bookId: string) {
  // The layout shows the review count in the navigation.
  revalidatePath(`/books/${bookId}`, "layout");
}

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<Partial<ReviewResult>>,
) {
  try {
    const actor = await editor(bookId);
    const result = await fn(actor);
    refresh(bookId);
    return { ok: true, ...result };
  } catch (err) {
    const state = actionError(err);
    return { ok: false, error: state.error, field: state.field };
  }
}

export async function approveAction(bookId: string, itemId: string, input: ApproveInput) {
  return run(bookId, async (actor) => {
    const { entry, ruleCreated } = await approveItem(getDb(), actor, bookId, itemId, input);
    return {
      entryId: entry.id,
      message: ruleCreated ? "Approved and saved as a rule." : "Approved.",
    };
  });
}

export async function transferAction(
  bookId: string,
  itemId: string,
  input: {
    partnerId: string;
    counterpartAccountId?: string;
    partnerCounterpartAccountId?: string;
    bucketId?: string;
  },
) {
  return run(bookId, async (actor) => {
    const { entries } = await approveTransfer(getDb(), actor, bookId, itemId, input);
    if (entries.length === 2) refresh(entries[1]!.bookId);
    return {
      entryId: entries[0]!.id,
      message: entries.length === 2 ? "Transfer recorded in both books." : "Transfer recorded.",
    };
  });
}

export async function linkAction(bookId: string, itemId: string, entryId: string) {
  return run(bookId, async (actor) => {
    await linkToEntry(getDb(), actor, bookId, itemId, entryId);
    return { entryId, message: "Matched to the existing entry." };
  });
}

export async function bulkAction(bookId: string, decisions: Decision[]) {
  return run(bookId, async (actor) => {
    const r = await applyDecisions(getDb(), actor, bookId, decisions);
    const skipped = r.skipped.length;
    return {
      message: `Approved ${r.approved}.${skipped ? ` ${skipped} skipped: ${r.skipped[0]!.reason}` : ""}`,
    };
  });
}

export async function excludeAction(bookId: string, itemId: string) {
  return run(bookId, async (actor) => {
    await excludeItem(getDb(), actor, bookId, itemId);
    return { message: "Excluded." };
  });
}

export async function excludeManyAction(bookId: string, itemIds: string[]) {
  return run(bookId, async (actor) => {
    for (const id of itemIds.slice(0, 500)) await excludeItem(getDb(), actor, bookId, id);
    return { message: `Excluded ${itemIds.length}.` };
  });
}

export async function restoreAction(bookId: string, itemId: string) {
  return run(bookId, async (actor) => {
    await restoreItem(getDb(), actor, bookId, itemId);
    return { message: "Back in For review." };
  });
}

export async function keepBothAction(bookId: string, itemId: string) {
  return run(bookId, async (actor) => {
    await keepBoth(getDb(), actor, bookId, itemId);
    return { message: "Kept as a separate transaction." };
  });
}

export async function undoApproveAction(bookId: string, entryId: string) {
  return run(bookId, async (actor) => {
    const { books } = await undoApproval(getDb(), actor, bookId, entryId);
    for (const b of books) refresh(b);
    return { message: "Undone. It's back in For review." };
  });
}
