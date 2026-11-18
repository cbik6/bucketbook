"use server";

import { refresh } from "next/cache";
import { actionError } from "@/server/action-state";
import { requireUser } from "@/server/auth/session";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import {
  createInvite,
  removePerson,
  renewInvite,
  revokeInvite,
  setPersonAccess,
  setPersonAdmin,
} from "@/server/people/service";

type Result = { error?: string; field?: string; link?: string };

const inviteLink = (token: string) => new URL(`/invite/${token}`, getEnv().APP_URL).toString();

async function run(fn: (actor: { userId: string }) => Promise<string | void>): Promise<Result> {
  try {
    const user = await requireUser();
    const token = await fn({ userId: user.id });
    refresh();
    return token ? { link: inviteLink(token) } : {};
  } catch (err) {
    const state = actionError(err);
    return { error: state.error, field: state.field };
  }
}

export async function inviteAction(input: unknown): Promise<Result> {
  return run(async (actor) => (await createInvite(getDb(), actor, input)).token);
}

export async function renewInviteAction(inviteId: string): Promise<Result> {
  return run(async (actor) => (await renewInvite(getDb(), actor, inviteId)).token);
}

export async function revokeInviteAction(inviteId: string): Promise<Result> {
  return run((actor) => revokeInvite(getDb(), actor, inviteId));
}

export async function setAccessAction(userId: string, access: unknown): Promise<Result> {
  return run((actor) => setPersonAccess(getDb(), actor, userId, access));
}

export async function setAdminAction(userId: string, admin: boolean): Promise<Result> {
  return run((actor) => setPersonAdmin(getDb(), actor, userId, admin));
}

export async function removePersonAction(userId: string): Promise<Result> {
  return run((actor) => removePerson(getDb(), actor, userId));
}
