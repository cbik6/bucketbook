import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { BOOK_ROLES, BOOK_TEMPLATES } from "../../../lib/account-types";
import { users } from "./auth";
import { inList } from "./sql-helpers";

/** A book is one entity with its own chart of accounts (Personal, an LLC, and so on). */
export const books = pgTable(
  "books",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Which starter chart of accounts it was created from. Informational only. */
    template: text("template").notNull(),
    /** Bank data before this date is ignored; opening balances are as of this date. */
    startDate: date("start_date", { mode: "string" }).notNull(),
    currencyCode: char("currency_code", { length: 3 }).notNull().default("USD"),
    /**
     * When false, accounts with sub-accounts are headings only: new entries,
     * rules and review choices must use one of the sub-accounts.
     */
    postToParents: boolean("post_to_parents").notNull().default(true),
    /**
     * How often its bank connections sync: every 24, 12, 6 or 4 hours, or 0 for
     * only when someone presses Sync now (see src/lib/bank-sync.ts).
     */
    bankSyncEveryHours: integer("bank_sync_every_hours").notNull().default(24),
    /** The first sync of the day, in the server's time zone. */
    bankSyncHour: integer("bank_sync_hour").notNull().default(6),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check("books_template_check", inList(t.template, BOOK_TEMPLATES)),
    check("books_currency_code_check", sql`${t.currencyCode} ~ '^[A-Z]{3}$'`),
    check("books_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check("books_bank_sync_every_hours_check", sql`${t.bankSyncEveryHours} in (0, 4, 6, 12, 24)`),
    check("books_bank_sync_hour_check", sql`${t.bankSyncHour} between 0 and 23`),
  ],
);

/** Who can use which book. Single user today; roles are ready for sharing later. */
export const bookMembers = pgTable(
  "book_members",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.userId] }),
    index("book_members_user_id_idx").on(t.userId),
    check("book_members_role_check", inList(t.role, BOOK_ROLES)),
  ],
);
