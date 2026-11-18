import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { count } from "drizzle-orm";
import { APP_NAME } from "@/lib/app-config";
import { recordAudit } from "../audit/record";
import { getDb } from "../db/client";
import * as schema from "../db/schema";
import { getEnv } from "../env";
import { completeInvite } from "../people/service";
import { inviteContext } from "../people/invite-context";

export const MIN_PASSWORD_LENGTH = 10;

function createAuth() {
  const env = getEnv();
  const db = getDb();
  return betterAuth({
    appName: APP_NAME,
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL, ...env.TRUSTED_ORIGINS],
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        users: schema.users,
        auth_sessions: schema.authSessions,
        auth_accounts: schema.authAccounts,
        auth_verifications: schema.authVerifications,
      },
    }),
    user: {
      modelName: "users",
      additionalFields: {
        // Never settable through sign-up; set by the hook below or by an admin.
        isAdmin: { type: "boolean", required: false, defaultValue: false, input: false },
      },
    },
    session: {
      modelName: "auth_sessions",
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh the expiry at most once a day
    },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 256,
      autoSignIn: true,
    },
    advanced: {
      database: { generateId: "uuid" },
    },
    telemetry: { enabled: false },
    databaseHooks: {
      user: {
        create: {
          // The first login sets up the install and becomes its admin. After that,
          // a login can only be created by accepting a valid invitation.
          before: async (user) => {
            const invite = inviteContext.getStore();
            if (invite) {
              if (user.email.toLowerCase() !== invite.email) {
                throw new APIError("FORBIDDEN", {
                  message: "That invitation is for a different email.",
                });
              }
              return { data: { ...user, isAdmin: false } };
            }
            const [row] = await db.select({ n: count() }).from(schema.users);
            if ((row?.n ?? 0) > 0) {
              throw new APIError("FORBIDDEN", {
                message: "Sign-up is closed. Ask the admin for an invitation.",
              });
            }
            return { data: { ...user, isAdmin: true } };
          },
          after: async (user) => {
            const invite = inviteContext.getStore();
            if (invite) await completeInvite(db, invite.inviteId, user.id);
            await recordAudit(db, {
              userId: user.id,
              entityType: "user",
              entityId: user.id,
              action: "create",
              after: { id: user.id, email: user.email, name: user.name },
            });
          },
        },
      },
    },
    // Must be last: lets server actions set the session cookie.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { __bucketbookAuth?: Auth };

/** Created on first use so `next build` never needs secrets or a database. */
export function getAuth(): Auth {
  globalForAuth.__bucketbookAuth ??= createAuth();
  return globalForAuth.__bucketbookAuth;
}
