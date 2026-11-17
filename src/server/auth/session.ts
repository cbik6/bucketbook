import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "../db/client";
import { getSetupState } from "../setup/service";
import { getAuth } from "./auth";

export type CurrentUser = { id: string; name: string; email: string };

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (!session) return null;
  return { id: session.user.id, name: session.user.name, email: session.user.email };
});

/**
 * Guard for app pages and server actions: sends people to setup if the
 * install isn't set up yet, or to login if they aren't signed in.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (user) return user;
  const setup = await getSetupState(getDb());
  redirect(setup.completed ? "/login" : "/setup");
}
