import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { accounts } from "./accounts";
import { books } from "./books";
import { inList } from "./sql-helpers";

export const ALLOCATION_KINDS = ["percent", "fixed", "monthly"] as const;
export type AllocationKind = (typeof ALLOCATION_KINDS)[number];

/**
 * Moves money from Unassigned into a bucket automatically.
 * percent: a share of each deposit. fixed: a set amount from each deposit.
 * monthly: a set amount once a month, from whatever is in Unassigned.
 * Rules run in priority order and never move more than is available.
 */
export const bucketRules = pgTable(
  "bucket_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    parentAccountId: uuid("parent_account_id").notNull(),
    bucketAccountId: uuid("bucket_account_id").notNull(),
    kind: text("kind").notNull(),
    amountCents: bigint("amount_cents", { mode: "number" }),
    /** Hundredths of a percent: 1000 means 10%. */
    percentBp: integer("percent_bp"),
    /** Only deposits at least this big (percent and fixed rules). */
    minDepositCents: bigint("min_deposit_cents", { mode: "number" }),
    priority: integer("priority").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    /** Last month a monthly rule ran, "2026-11". */
    lastRunMonth: text("last_run_month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    foreignKey({
      name: "bucket_rules_parent_fk",
      columns: [t.bookId, t.parentAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "bucket_rules_bucket_fk",
      columns: [t.bookId, t.bucketAccountId],
      foreignColumns: [accounts.bookId, accounts.id],
    }).onDelete("cascade"),
    index("bucket_rules_parent_idx").on(t.parentAccountId, t.priority),
    check("bucket_rules_kind_check", inList(t.kind, ALLOCATION_KINDS)),
    check(
      "bucket_rules_amount_shape",
      sql`(${t.kind} = 'percent' and ${t.percentBp} between 1 and 10000 and ${t.amountCents} is null)
        or (${t.kind} in ('fixed', 'monthly') and ${t.amountCents} > 0 and ${t.percentBp} is null)`,
    ),
  ],
);
