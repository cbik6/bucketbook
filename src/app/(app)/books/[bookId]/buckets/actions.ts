"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { requireBookAccess } from "@/server/books/service";
import {
  createBucket,
  createBucketRule,
  deleteBucketRule,
  enableBuckets,
  moveBetweenBuckets,
  moveBucketRule,
  runMonthlyRules,
  updateBucket,
} from "@/server/buckets/service";
import { getDb } from "@/server/db/client";

export type BucketResult = { ok: boolean; error?: string; field?: string; message?: string };

async function run(
  bookId: string,
  fn: (actor: { userId: string }) => Promise<string | void>,
): Promise<BucketResult> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    const message = await fn({ userId: user.id });
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true, message: message || undefined };
  } catch (err) {
    const s = actionError(err);
    return { ok: false, error: s.error, field: s.field };
  }
}

export async function enableBucketsAction(bookId: string, accountId: string, names: string[]) {
  return run(bookId, async (actor) => {
    await enableBuckets(getDb(), actor, bookId, accountId, { names });
    return "Buckets are on. The current balance is in Unassigned.";
  });
}

export async function saveBucketAction(
  bookId: string,
  target: { parentId: string } | { bucketId: string },
  input: { name: string; color?: string | null; goal: string; goalDate: string },
) {
  return run(bookId, async (actor) => {
    if ("bucketId" in target) {
      await updateBucket(getDb(), actor, bookId, target.bucketId, input);
      return "Bucket saved.";
    }
    await createBucket(getDb(), actor, bookId, target.parentId, input);
    return "Bucket added.";
  });
}

export async function moveMoneyAction(
  bookId: string,
  input: { fromId: string; toId: string; amount: string; date: string; memo: string },
) {
  return run(bookId, async (actor) => {
    await moveBetweenBuckets(getDb(), actor, bookId, input);
    return "Moved.";
  });
}

export async function saveBucketRuleAction(bookId: string, parentId: string, input: unknown) {
  return run(bookId, async (actor) => {
    await createBucketRule(getDb(), actor, bookId, parentId, input);
    return "Rule added. It applies to deposits approved from now on.";
  });
}

export async function deleteBucketRuleAction(bookId: string, ruleId: string) {
  return run(bookId, async (actor) => {
    await deleteBucketRule(getDb(), actor, bookId, ruleId);
    return "Rule removed.";
  });
}

export async function moveBucketRuleAction(
  bookId: string,
  ruleId: string,
  direction: "up" | "down",
) {
  return run(bookId, async (actor) => {
    await moveBucketRule(getDb(), actor, bookId, ruleId, direction);
  });
}

export async function runMonthlyAction(bookId: string) {
  return run(bookId, async (actor) => {
    const r = await runMonthlyRules(getDb(), actor, { bookId });
    return r.movedCents
      ? "Monthly rules ran."
      : "Nothing to move: this month's rules already ran, or Unassigned is empty.";
  });
}
