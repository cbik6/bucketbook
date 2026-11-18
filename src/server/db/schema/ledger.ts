import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { accounts } from "./accounts";
import { books } from "./books";
import { inList } from "./sql-helpers";

/**
 * manual: typed on the journal screen. opening_balance: the one opening entry.
 * reversal: cancels another entry. bank: approved from the review queue.
 * transfer: money moving between two of your own accounts (one entry per book).
 * bucket: money moving between buckets inside one real account (allocations
 * and manual moves). The real account's total never changes.
 * valuation: an investment account's change in market value, from a sync.
 */
export const ENTRY_KINDS = [
  "manual",
  "opening_balance",
  "reversal",
  "bank",
  "transfer",
  "bucket",
  "valuation",
] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * One journal entry. The header holds the current date and memo; every
 * version of the entry is kept in journal_entry_versions and its lines in
 * journal_lines, so nothing posted is ever overwritten.
 */
export const journalEntries = pgTable(
  "journal_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    /** Human-friendly number per book (JE 1, JE 2, ...). */
    entryNumber: integer("entry_number").notNull(),
    kind: text("kind").notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    /** Who the money went to or came from, when there is one. */
    payee: text("payee"),
    memo: text("memo"),
    currentVersion: integer("current_version").notNull().default(1),
    /** Set on a reversal: the entry it cancels out. */
    reversesEntryId: uuid("reverses_entry_id"),
    /**
     * Shared by the two entries of a transfer between books (one entry in each
     * book), so either side can find and warn about the other.
     */
    transferGroupId: uuid("transfer_group_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("journal_entries_book_id_id_key").on(t.bookId, t.id),
    unique("journal_entries_book_number_key").on(t.bookId, t.entryNumber),
    foreignKey({
      name: "journal_entries_reverses_fk",
      columns: [t.bookId, t.reversesEntryId],
      foreignColumns: [t.bookId, t.id],
    }),
    uniqueIndex("journal_entries_one_reversal_key")
      .on(t.reversesEntryId)
      .where(sql`${t.reversesEntryId} is not null`),
    uniqueIndex("journal_entries_one_opening_key")
      .on(t.bookId)
      .where(sql`${t.kind} = 'opening_balance'`),
    index("journal_entries_book_date_idx").on(t.bookId, t.entryDate),
    index("journal_entries_transfer_group_idx")
      .on(t.transferGroupId)
      .where(sql`${t.transferGroupId} is not null`),
    check("journal_entries_kind_check", inList(t.kind, ENTRY_KINDS)),
    check("journal_entries_version_positive", sql`${t.currentVersion} >= 1`),
    check("journal_entries_number_positive", sql`${t.entryNumber} >= 1`),
    check(
      "journal_entries_reversal_link",
      sql`(${t.kind} = 'reversal') = (${t.reversesEntryId} is not null)`,
    ),
  ],
);

/** The header of each version of an entry, for the history view. */
export const journalEntryVersions = pgTable(
  "journal_entry_versions",
  {
    entryId: uuid("entry_id")
      .notNull()
      .references(() => journalEntries.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    entryDate: date("entry_date", { mode: "string" }).notNull(),
    payee: text("payee"),
    memo: text("memo"),
    /** Why this version exists, for example "Edited" or "Created". */
    changeNote: text("change_note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.entryId, t.version] })],
);

/**
 * Debit and credit lines. Amounts are integer cents; each line is a debit or
 * a credit, never both. Lines are append-only: an edit marks the old lines
 * is_current = false and adds new ones under the next version.
 */
export const journalLines = pgTable(
  "journal_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id").notNull(),
    entryId: uuid("entry_id").notNull(),
    version: integer("version").notNull(),
    lineNumber: integer("line_number").notNull(),
    accountId: uuid("account_id").notNull(),
    debitCents: bigint("debit_cents", { mode: "number" }).notNull().default(0),
    creditCents: bigint("credit_cents", { mode: "number" }).notNull().default(0),
    memo: text("memo"),
    isCurrent: boolean("is_current").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "journal_lines_entry_fk",
      columns: [t.bookId, t.entryId],
      foreignColumns: [journalEntries.bookId, journalEntries.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_version_fk",
      columns: [t.entryId, t.version],
      foreignColumns: [journalEntryVersions.entryId, journalEntryVersions.version],
    }).onDelete("cascade"),
    foreignKey({
      name: "journal_lines_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    unique("journal_lines_entry_version_line_key").on(t.entryId, t.version, t.lineNumber),
    index("journal_lines_entry_idx").on(t.entryId),
    index("journal_lines_current_account_idx")
      .on(t.accountId)
      .where(sql`${t.isCurrent}`),
    check("journal_lines_debit_nonnegative", sql`${t.debitCents} >= 0`),
    check("journal_lines_credit_nonnegative", sql`${t.creditCents} >= 0`),
    check("journal_lines_one_side", sql`(${t.debitCents} > 0) <> (${t.creditCents} > 0)`),
  ],
);
