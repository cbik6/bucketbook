import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { users } from "./auth";
import { books } from "./books";
import { journalEntries } from "./ledger";
import { inList } from "./sql-helpers";

/**
 * One SimpleFIN login (one Access URL), owned by one book. Its bank accounts
 * feed only that book, so two books can connect the same bank separately and
 * keep their own transactions. The Access URL holds credentials, so only its
 * encrypted form is stored.
 */
export const simplefinConnections = pgTable(
  "simplefin_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    accessUrlCiphertext: text("access_url_ciphertext").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    /** Daily sync time, in the server's time zone. The minute is random so installs spread out. */
    syncHour: integer("sync_hour").notNull().default(6),
    syncMinute: integer("sync_minute").notNull().default(17),
    /** Set while a sync runs, so a scheduled and a manual sync never overlap. */
    syncStartedAt: timestamp("sync_started_at", { withTimezone: true }),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncStatus: text("last_sync_status"),
    /** Messages from the bridge or the sync itself, safe to show (never the Access URL). */
    lastSyncMessages: jsonb("last_sync_messages").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("simplefin_connections_book_id_id_key").on(t.bookId, t.id),
    index("simplefin_connections_book_idx").on(t.bookId),
    check("simplefin_connections_sync_hour", sql`${t.syncHour} between 0 and 23`),
    check("simplefin_connections_sync_minute", sql`${t.syncMinute} between 0 and 59`),
    check(
      "simplefin_connections_status_check",
      sql`${t.lastSyncStatus} is null or ${inList(t.lastSyncStatus, ["ok", "warning", "error"])}`,
    ),
  ],
);

/**
 * Every request made to the bridge. The bridge expects about 24 requests a
 * day, so the app counts these before sending more.
 */
export const simplefinRequests = pgTable(
  "simplefin_requests",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => simplefinConnections.id, { onDelete: "cascade" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    windowStart: date("window_start", { mode: "string" }),
    windowEnd: date("window_end", { mode: "string" }),
    ok: boolean("ok").notNull(),
    newCount: integer("new_count").notNull().default(0),
    updatedCount: integer("updated_count").notNull().default(0),
  },
  (t) => [index("simplefin_requests_connection_time_idx").on(t.connectionId, t.requestedAt)],
);

/**
 * A bank account seen through SimpleFIN. Mapping it to an account in a book
 * (or ignoring it) decides where its transactions go.
 */
export const bankFeeds = pgTable(
  "bank_feeds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => simplefinConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    institution: text("institution"),
    name: text("name").notNull(),
    currency: text("currency").notNull(),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    accountId: uuid("account_id"),
    ignored: boolean("ignored").notNull().default(false),
    /**
     * The bank reports this account's sign backwards (a savings balance shown as
     * negative, say). Balances and transaction amounts are flipped as they come
     * in, so everything stored here reads the usual way.
     */
    reversedSign: boolean("reversed_sign").notNull().default(false),
    /** The bank's own figures from the last sync (flipped when reversedSign). */
    balanceCents: bigint("balance_cents", { mode: "number" }),
    availableBalanceCents: bigint("available_balance_cents", { mode: "number" }),
    balanceAt: timestamp("balance_at", { withTimezone: true }),
    /**
     * Transactions dated before this day are never brought in. Set to the day the
     * account is connected, so opening balances (as of that day) aren't duplicated
     * by history.
     */
    importFrom: date("import_from", { mode: "string" }),
    /** The newest day fetched for this account; the next sync starts a few days before it. */
    syncedThrough: date("synced_through", { mode: "string" }),
    /** The oldest day fetched, so a backfill knows where it stopped. */
    syncedFrom: date("synced_from", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bank_feeds_connection_external_key").on(t.connectionId, t.externalId),
    // A mapped feed goes to its connection's book and no other.
    foreignKey({
      name: "bank_feeds_connection_book_fk",
      columns: [t.bookId, t.connectionId],
      foreignColumns: [simplefinConnections.bookId, simplefinConnections.id],
    }),
    foreignKey({
      name: "bank_feeds_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    // One feed per ledger account, so the same bank data can't come in twice.
    uniqueIndex("bank_feeds_account_key")
      .on(t.accountId)
      .where(sql`${t.accountId} is not null`),
    check("bank_feeds_mapping_complete", sql`(${t.bookId} is null) = (${t.accountId} is null)`),
    check("bank_feeds_ignored_unmapped", sql`not (${t.ignored} and ${t.accountId} is not null)`),
  ],
);

export const BANK_TX_SOURCES = ["simplefin", "csv"] as const;
export type BankTxSource = (typeof BANK_TX_SOURCES)[number];

/**
 * pending: shown, never posted until it clears. review: waiting in For review.
 * posted: recorded by a journal entry. excluded: you said to skip it.
 * removed: a pending charge the bank dropped or replaced when it posted.
 */
export const BANK_TX_STATUSES = ["pending", "review", "posted", "excluded", "removed"] as const;
export type BankTxStatus = (typeof BANK_TX_STATUSES)[number];

/** approved: categorized in review. transfer: matched with the other side. linked: matched to an entry that already existed. */
export const POST_METHODS = ["approved", "transfer", "linked"] as const;
export type PostMethod = (typeof POST_METHODS)[number];

/**
 * A transaction from the bank (SimpleFIN or a CSV file). Amounts use the
 * bank's sign: positive means the account went up, which is always a debit to
 * the ledger account, whether it is a bank account or a credit card.
 */
export const bankTransactions = pgTable(
  "bank_transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    feedId: uuid("feed_id").references(() => bankFeeds.id, { onDelete: "set null" }),
    source: text("source").notNull(),
    /** SimpleFIN's transaction id, or a fingerprint of the CSV row. */
    externalId: text("external_id").notNull(),
    importBatchId: uuid("import_batch_id"),
    postedDate: date("posted_date", { mode: "string" }).notNull(),
    transactedDate: date("transacted_date", { mode: "string" }),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    description: text("description").notNull(),
    payee: text("payee"),
    bankMemo: text("bank_memo"),
    status: text("status").notNull(),
    postMethod: text("post_method"),
    entryId: uuid("entry_id"),
    /** A transaction that looks like this one. You confirm before it is skipped. */
    duplicateOfId: uuid("duplicate_of_id"),
    /** What the rules suggest. Nothing posts until you approve. */
    suggestedAccountId: uuid("suggested_account_id"),
    suggestedBucketId: uuid("suggested_bucket_id"),
    suggestedPayee: text("suggested_payee"),
    suggestedMemo: text("suggested_memo"),
    suggestedTransfer: boolean("suggested_transfer").notNull().default(false),
    suggestedRuleId: uuid("suggested_rule_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("bank_transactions_book_id_id_key").on(t.bookId, t.id),
    foreignKey({
      name: "bank_transactions_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }),
    foreignKey({
      name: "bank_transactions_entry_fk",
      columns: [t.bookId, t.entryId],
      foreignColumns: [journalEntries.bookId, journalEntries.id],
    }),
    foreignKey({
      name: "bank_transactions_duplicate_fk",
      columns: [t.duplicateOfId],
      foreignColumns: [t.id],
    }).onDelete("set null"),
    // SimpleFIN ids are unique per bank account; CSV fingerprints per ledger account.
    uniqueIndex("bank_transactions_feed_external_key")
      .on(t.feedId, t.externalId)
      .where(sql`${t.source} = 'simplefin' and ${t.feedId} is not null`),
    uniqueIndex("bank_transactions_csv_external_key")
      .on(t.accountId, t.externalId)
      .where(sql`${t.source} = 'csv'`),
    // An entry can account for at most one bank transaction per account.
    uniqueIndex("bank_transactions_entry_account_key")
      .on(t.entryId, t.accountId)
      .where(sql`${t.entryId} is not null`),
    index("bank_transactions_book_status_idx").on(t.bookId, t.status, t.postedDate),
    index("bank_transactions_account_date_idx").on(t.accountId, t.postedDate),
    check("bank_transactions_source_check", inList(t.source, BANK_TX_SOURCES)),
    check("bank_transactions_status_check", inList(t.status, BANK_TX_STATUSES)),
    check(
      "bank_transactions_post_method_check",
      sql`${t.postMethod} is null or ${inList(t.postMethod, POST_METHODS)}`,
    ),
    check("bank_transactions_amount_nonzero", sql`${t.amountCents} <> 0`),
    check(
      "bank_transactions_posted_link",
      sql`(${t.status} = 'posted') = (${t.entryId} is not null and ${t.postMethod} is not null)`,
    ),
  ],
);

/**
 * Categorization rules for one book. Rules are tried in priority order; for
 * each action, the first matching rule that sets it wins.
 */
export const bankRules = pgTable(
  "bank_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    priority: integer("priority").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Validated by `ruleConditionsSchema` in src/lib/rules.ts. */
    conditions: jsonb("conditions").notNull(),
    /** Validated by `ruleActionsSchema` in src/lib/rules.ts. */
    actions: jsonb("actions").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("bank_rules_book_priority_idx").on(t.bookId, t.priority),
    check("bank_rules_name_not_blank", sql`length(trim(${t.name})) > 0`),
  ],
);

/** Saved column mapping for CSV files from one account's bank. */
export const csvPresets = pgTable(
  "csv_presets",
  {
    bookId: uuid("book_id").notNull(),
    accountId: uuid("account_id").notNull(),
    /** Validated by `csvMappingSchema` in src/lib/csv-import.ts. */
    mapping: jsonb("mapping").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.accountId] }),
    foreignKey({
      name: "csv_presets_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
  ],
);

/**
 * For transfers between books: the account in `bookId` that stands for the
 * other book (for example "Owner Contribution" in an LLC, or "Investment in
 * LLC" at home). Remembered the first time you approve such a transfer.
 */
export const bookCounterparts = pgTable(
  "book_counterparts",
  {
    bookId: uuid("book_id").notNull(),
    otherBookId: uuid("other_book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    accountId: uuid("account_id").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.bookId, t.otherBookId] }),
    foreignKey({
      name: "book_counterparts_account_fk",
      columns: [t.bookId, t.accountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    check("book_counterparts_other_book", sql`${t.bookId} <> ${t.otherBookId}`),
  ],
);

/** A receipt or other file attached to a journal entry or a bank transaction. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    entryId: uuid("entry_id"),
    bankTransactionId: uuid("bank_transaction_id"),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "attachments_entry_fk",
      columns: [t.bookId, t.entryId],
      foreignColumns: [journalEntries.bookId, journalEntries.id],
    }),
    foreignKey({
      name: "attachments_bank_tx_fk",
      columns: [t.bookId, t.bankTransactionId],
      foreignColumns: [bankTransactions.bookId, bankTransactions.id],
    }),
    index("attachments_entry_idx").on(t.entryId),
    index("attachments_bank_tx_idx").on(t.bankTransactionId),
    check("attachments_one_target", sql`num_nonnulls(${t.entryId}, ${t.bankTransactionId}) = 1`),
    check("attachments_size_positive", sql`${t.sizeBytes} > 0`),
  ],
);
