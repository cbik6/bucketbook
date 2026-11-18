import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  pgTable,
  primaryKey,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { books } from "./books";

/**
 * Monthly budget amounts per income or expense account. Amounts are in the
 * account's natural direction: what you expect to earn or spend that month.
 */
export const budgets = pgTable(
  "budgets",
  {
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    /** The first day of the month. */
    month: date("month", { mode: "string" }).notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.month] }),
    foreignKey({
      name: "budgets_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    check("budgets_month_first_day", sql`extract(day from ${t.month}) = 1`),
    check("budgets_amount_nonnegative", sql`${t.amountCents} >= 0`),
  ],
);
