import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { users } from "./auth";
import { books } from "./books";
import { journalEntries } from "./ledger";
import { inList } from "./sql-helpers";

/**
 * A bank statement matched against the books for one real account (never a
 * single bucket). Balances use the ledger's sign: debits minus credits, so a
 * credit card you owe on is negative.
 */
export const reconciliations = pgTable(
  "reconciliations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    statementDate: date("statement_date", { mode: "string" }).notNull(),
    statementBalanceCents: bigint("statement_balance_cents", { mode: "number" }).notNull(),
    beginningBalanceCents: bigint("beginning_balance_cents", { mode: "number" }).notNull(),
    status: text("status").notNull().default("open"),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "reconciliations_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    uniqueIndex("reconciliations_one_open_key")
      .on(t.accountId)
      .where(sql`${t.status} = 'open'`),
    index("reconciliations_account_date_idx").on(t.accountId, t.statementDate),
    check("reconciliations_status_check", inList(t.status, ["open", "finished"])),
    check(
      "reconciliations_finished_at",
      sql`(${t.status} = 'finished') = (${t.finishedAt} is not null)`,
    ),
  ],
);

/**
 * The entries checked off as cleared on a statement, with the amount they
 * contributed to the account at that moment. An entry clears once per account.
 */
export const reconciliationItems = pgTable(
  "reconciliation_items",
  {
    reconciliationId: uuid("reconciliation_id")
      .notNull()
      .references(() => reconciliations.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.reconciliationId, t.entryId] }),
    uniqueIndex("reconciliation_items_entry_account_key").on(t.entryId, t.accountId),
  ],
);

/**
 * A loan on a liability account: what was borrowed, the rate and term, and
 * which expense account takes the interest part of each payment.
 */
export const loans = pgTable(
  "loans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    interestAccountId: uuid("interest_account_id").notNull(),
    principalCents: bigint("principal_cents", { mode: "number" }).notNull(),
    /** Annual rate in millionths: 6.5% is 65000. */
    annualRateMicro: integer("annual_rate_micro").notNull(),
    termMonths: integer("term_months").notNull(),
    firstPaymentDate: date("first_payment_date", { mode: "string" }).notNull(),
    paymentCents: bigint("payment_cents", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "loans_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "loans_interest_account_fk",
      columns: [t.bookId, t.interestAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    uniqueIndex("loans_account_key").on(t.accountId),
    check("loans_principal_positive", sql`${t.principalCents} > 0`),
    check("loans_rate_range", sql`${t.annualRateMicro} between 0 and 1000000`),
    check("loans_term_range", sql`${t.termMonths} between 1 and 600`),
    check("loans_payment_positive", sql`${t.paymentCents} > 0`),
  ],
);
