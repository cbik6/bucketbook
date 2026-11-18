"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { type ActionState, actionError, formValues } from "@/server/action-state";
import { MIN_PASSWORD_LENGTH, getAuth } from "@/server/auth/auth";
import { getDb } from "@/server/db/client";
import { UserFacingError } from "@/server/errors";
import { inviteContext } from "@/server/people/invite-context";
import { findInvite } from "@/server/people/service";

/** Creates the invited person's login, gives them their books, and signs them in. */
export async function acceptInviteAction(
  token: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const values = formValues(formData, ["name"]);
  try {
    const invite = await findInvite(getDb(), token);
    if (!invite) {
      throw new UserFacingError(
        "This invitation has expired or was withdrawn. Ask for a new link.",
      );
    }
    const name = values.name!.trim();
    const password = String(formData.get("password") ?? "");
    if (!name) throw new UserFacingError("Tell us what to call you.", "name");
    if (name.length > 100)
      throw new UserFacingError("Keep your name under 100 characters.", "name");
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new UserFacingError(
        `Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`,
        "password",
      );
    }
    const requestHeaders = await headers();
    await inviteContext.run({ inviteId: invite.id, email: invite.email }, () =>
      getAuth().api.signUpEmail({
        body: { name, email: invite.email, password },
        headers: requestHeaders,
      }),
    );
  } catch (err) {
    return actionError(err, values);
  }
  redirect("/");
}
