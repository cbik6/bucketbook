"use server";

import { revalidatePath } from "next/cache";
import { type ActionState, actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import { syncSchedules } from "@/server/jobs/simplefin";
import {
  type SyncResult,
  connectSimplefin,
  disconnectSimplefin,
  mapFeed,
  runSync,
  setSyncTime,
} from "@/server/simplefin/service";

async function actor() {
  const user = await requireUser();
  return { userId: user.id };
}

async function refreshSchedules() {
  // The queue may be off (JOBS_ENABLED=false); schedules then wait for the next start.
  await syncSchedules().catch((err: Error) =>
    console.error("[jobs] schedule update failed:", err.message),
  );
}

export async function connectAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const a = await actor();
    const token = String(formData.get("token") ?? "");
    const { accountCount, messages } = await connectSimplefin(getDb(), a, token);
    await refreshSchedules();
    revalidatePath("/connections");
    const found = `Connected. SimpleFIN reports ${accountCount} ${accountCount === 1 ? "account" : "accounts"}.`;
    return { success: messages.length ? `${found} ${messages.join(" ")}` : found };
  } catch (err) {
    return actionError(err);
  }
}

export type SyncActionResult = Pick<
  SyncResult,
  "status" | "messages" | "newCount" | "updatedCount" | "moreToFetch"
>;

export async function syncNowAction(connectionId: string): Promise<SyncActionResult> {
  try {
    const a = await actor();
    const result = await runSync(getDb(), connectionId, { trigger: "manual", userId: a.userId });
    revalidatePath("/", "layout");
    return result;
  } catch (err) {
    const state = actionError(err);
    return {
      status: "error",
      messages: [state.error ?? "Sync failed."],
      newCount: 0,
      updatedCount: 0,
      moreToFetch: false,
    };
  }
}

export async function mapFeedAction(
  feedId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  try {
    const a = await actor();
    const choice = String(formData.get("accountId") ?? "");
    let mode = String(formData.get("mode") ?? "map");
    if (mode === "map" && choice === "new") mode = "create";
    const parent = String(formData.get("parentAccountId") ?? "");
    if (
      mode === "create" &&
      parent === "group" &&
      !String(formData.get("groupName") ?? "").trim()
    ) {
      throw new UserFacingError("Name the new group, for example Marcus.", "groupName");
    }
    await mapFeed(getDb(), a, feedId, {
      mode,
      bookId: String(formData.get("bookId") ?? ""),
      accountId: choice,
      kind: String(formData.get("kind") ?? ""),
      name: String(formData.get("name") ?? ""),
      parentAccountId: parent && parent !== "group" ? parent : undefined,
      groupName: parent === "group" ? String(formData.get("groupName") ?? "") : undefined,
    });
    revalidatePath("/connections");
    return {
      success:
        mode === "map" || mode === "create"
          ? "Saved. Press Sync now to bring in its transactions."
          : mode === "ignore"
            ? "This account will be ignored."
            : "Mapping removed.",
    };
  } catch (err) {
    return actionError(err);
  }
}

export async function setSyncTimeAction(connectionId: string, hour: number): Promise<ActionState> {
  try {
    const a = await actor();
    await setSyncTime(getDb(), a, connectionId, hour);
    await refreshSchedules();
    revalidatePath("/connections");
    return { success: "Sync time saved." };
  } catch (err) {
    return actionError(err);
  }
}

export async function disconnectAction(connectionId: string): Promise<ActionState> {
  try {
    const a = await actor();
    if (!connectionId) throw new UserFacingError("Pick a connection.");
    await disconnectSimplefin(getDb(), a, connectionId);
    await refreshSchedules();
    revalidatePath("/connections");
    return { success: "Disconnected. Transactions already brought in are kept." };
  } catch (err) {
    return actionError(err);
  }
}
