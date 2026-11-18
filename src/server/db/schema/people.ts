import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { BookRole } from "@/lib/account-types";
import { users } from "./auth";

export type InviteAccess = { bookId: string; role: BookRole }[];

/**
 * An admin's invitation for someone to join. The link carries a random token;
 * only its SHA-256 hash is stored, so the table never holds a usable link.
 * Book access is granted when the invitation is accepted.
 */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    access: jsonb("access").$type<InviteAccess>().notNull().default([]),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    acceptedUserId: uuid("accepted_user_id").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitations_email_idx").on(t.email),
    check("invitations_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);
