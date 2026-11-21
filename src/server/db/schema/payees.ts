import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { books } from "./books";

/**
 * Who money goes to or comes from: "Taco Bell", "Rocky Mountain Power". Each
 * book keeps its own list. An entry links to its payee (journal_entries.payee_id)
 * and keeps the name as text too, so renaming or merging a payee updates every
 * entry that uses it while each entry's version history keeps what it said then.
 */
export const payees = pgTable(
  "payees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The category this payee usually goes to, suggested in review. */
    defaultAccountId: uuid("default_account_id").references(() => accounts.id, {
      onDelete: "set null",
    }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("payees_book_name_key").on(t.bookId, sql`lower(${t.name})`)],
);

/**
 * Bank text that means a payee: the store name the category learner reads
 * from a bank description ("TACO BELL 729852 22 WEST MAIN ST" is "taco bell"),
 * learned each time you add a bank transaction under a payee.
 */
export const payeeMatches = pgTable(
  "payee_matches",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    payeeId: uuid("payee_id")
      .notNull()
      .references(() => payees.id, { onDelete: "cascade" }),
    /** One of the bank descriptions it was learned from, to show on the Payees page. */
    sample: text("sample"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.key] }),
    index("payee_matches_payee_idx").on(t.payeeId),
  ],
);
