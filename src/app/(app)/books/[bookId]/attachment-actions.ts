"use server";

import { revalidatePath } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import {
  type AttachmentTarget,
  deleteAttachment,
  saveAttachment,
} from "@/server/bank/attachments-service";
import { requireBookAccess } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";

export type AttachmentResult = { ok: boolean; error?: string };

/** Uploads one or more receipts to a journal entry or a bank transaction. */
export async function uploadAttachmentsAction(
  bookId: string,
  target: AttachmentTarget,
  formData: FormData,
): Promise<AttachmentResult> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    const files = formData
      .getAll("files")
      .filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) throw new UserFacingError("Choose a file to attach.");
    for (const file of files.slice(0, 10)) {
      await saveAttachment(getDb(), { userId: user.id }, bookId, target, {
        name: file.name,
        bytes: Buffer.from(await file.arrayBuffer()),
      });
    }
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}

export async function deleteAttachmentAction(
  bookId: string,
  attachmentId: string,
): Promise<AttachmentResult> {
  try {
    const user = await requireUser();
    await requireBookAccess(getDb(), user.id, bookId, "editor");
    await deleteAttachment(getDb(), { userId: user.id }, bookId, attachmentId);
    revalidatePath(`/books/${bookId}`, "layout");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: actionError(err).error };
  }
}
