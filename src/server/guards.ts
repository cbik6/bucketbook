import "server-only";
import { notFound } from "next/navigation";
import type { BookRole } from "@/lib/account-types";
import { type CurrentUser, requireUser } from "./auth/session";
import { type BookWithRole, requireBookAccess } from "./books/service";
import { getDb } from "./db/client";
import { NotFoundError } from "./errors";

/** For pages: the signed-in user and the book, or a 404 if they can't see it. */
export async function loadBookForPage(
  bookId: string,
  minRole: BookRole = "viewer",
): Promise<{ user: CurrentUser; book: BookWithRole }> {
  const user = await requireUser();
  try {
    const book = await requireBookAccess(getDb(), user.id, bookId, minRole);
    return { user, book };
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
