"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { getAuth } from "@/server/auth/auth";
import { getCurrentUser } from "@/server/auth/session";
import { createBook, listBooksForUser } from "@/server/books/service";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import { getSetupState, markSetupComplete } from "@/server/setup/service";

export async function createAdminAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name", "email"]);
  try {
    const setup = await getSetupState(getDb());
    if (setup.hasUser)
      throw new UserFacingError("This install already has an owner. Sign in instead.");
    const name = values.name!.trim();
    const email = values.email!.trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!name) throw new UserFacingError("Tell us what to call you.", "name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new UserFacingError("Enter a valid email address.", "email");
    }
    if (password.length < 10) {
      throw new UserFacingError("Use at least 10 characters for your password.", "password");
    }
    await getAuth().api.signUpEmail({ body: { name, email, password }, headers: await headers() });
  } catch (err) {
    return actionError(err, values);
  }
  redirect("/setup");
}

export async function createFirstBookAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name", "template", "startDate"]);
  try {
    const user = await getCurrentUser();
    if (!user) throw new UserFacingError("Your session ended. Sign in to continue setup.");
    const existing = await listBooksForUser(getDb(), user.id, { includeArchived: true });
    if (existing.length === 0) await createBook(getDb(), { userId: user.id }, values);
  } catch (err) {
    return actionError(err, values);
  }
  redirect("/setup");
}

export async function finishSetupAction(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/setup");
  const db = getDb();
  const [book] = await listBooksForUser(db, user.id);
  if (!book) redirect("/setup");
  const setup = await getSetupState(db);
  if (!setup.completed) await markSetupComplete(db, user.id);
  redirect(`/books/${book.id}/accounts?welcome=1`);
}
