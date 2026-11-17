"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { getAuth } from "@/server/auth/auth";
import { UserFacingError } from "@/server/errors";

/** Only allow redirects back into this app, never to another site. */
function safeNext(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : "/";
}

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const values = formValues(formData, ["email", "next"]);
  try {
    const email = values.email!.trim().toLowerCase();
    const password = String(formData.get("password") ?? "");
    if (!email || !password) throw new UserFacingError("Enter your email and password.");
    await getAuth().api.signInEmail({ body: { email, password }, headers: await headers() });
  } catch (err) {
    const state = actionError(err, values);
    // Same message for unknown email and wrong password, so emails can't be probed.
    if (state.error && !state.field && state.error !== "Enter your email and password.") {
      return { error: "That email and password don't match. Try again.", values };
    }
    return state;
  }
  redirect(safeNext(values.next ?? "/"));
}

export async function signOutAction(): Promise<void> {
  await getAuth().api.signOut({ headers: await headers() });
  redirect("/login");
}
