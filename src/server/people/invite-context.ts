import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Set only while the app itself accepts an invitation, around its own call to
 * create the login. The sign-up hook checks it, so the public sign-up endpoint
 * can never create a login without a valid invitation, even for an invited email.
 */
export const inviteContext = new AsyncLocalStorage<{ inviteId: string; email: string }>();
