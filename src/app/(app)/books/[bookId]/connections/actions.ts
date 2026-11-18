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
  guidedConnect,
  openingFromBank,
  mapFeed,
  runSync,
  setSyncTime,
} from "@/server/simplefin/service";

// Book roles are checked in the service: editors map and sync, owners connect.
async function actor() {
  const user = await requireUser();
  return { userId: user.id };
}

const revalidate = () => revalidatePath("/books/[bookId]/connections", "page");

async function refreshSchedules() {
  // The queue may be off (JOBS_ENABLED=false); schedules then wait for the next start.
  await syncSchedules().catch((err: Error) =>
    console.error("[jobs] schedule update failed:", err.message),
  );
}

export async function connectAction(
  bookId: string,
  _prev: ActionState & { connectionId?: string },
  formData: FormData,
): Promise<ActionState & { connectionId?: string }> {
  try {
    const a = await actor();
    if (formData.get("accepted") !== "on") {
      throw new UserFacingError(
        "Tick the box to agree to SimpleFIN's terms and Bucketbook's no-warranty notice.",
        "accepted",
      );
    }
    const token = String(formData.get("token") ?? "");
    const { connection, accountCount, messages } = await connectSimplefin(
      getDb(),
      a,
      bookId,
      token,
    );
    await refreshSchedules();
    revalidate();
    const found = `Connected. SimpleFIN reports ${accountCount} ${accountCount === 1 ? "account" : "accounts"}.`;
    return {
      success: messages.length ? `${found} ${messages.join(" ")}` : found,
      connectionId: connection.id,
    };
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
    const mapped = await mapFeed(getDb(), a, feedId, {
      mode,
      accountId: choice,
      kind: String(formData.get("kind") ?? ""),
      name: String(formData.get("name") ?? ""),
    });
    if (mode === "map" || mode === "create") await openingFromBank(getDb(), a, mapped);
    revalidate();
    return {
      success:
        mode === "map" || mode === "create"
          ? "Connected, with the bank's balance today as its opening balance. Press Sync now to bring in today's transactions."
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
    revalidate();
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
    revalidate();
    return { success: "Disconnected. Transactions already brought in are kept." };
  } catch (err) {
    return actionError(err);
  }
}

export async function guidedConnectAction(
  feedId: string,
  input: {
    choice: "new" | "existing" | "ignore";
    kind?: string;
    name?: string;
    accountId?: string;
    reversedSign?: boolean;
  },
): Promise<ActionState> {
  try {
    const a = await actor();
    await guidedConnect(getDb(), a, feedId, input);
    revalidatePath("/", "layout");
    return { success: "ok" };
  } catch (err) {
    return actionError(err);
  }
}
