import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ACCOUNT_TYPES, ALL_SUBTYPES, SYSTEM_ROLES } from "../../../lib/account-types";
import { books } from "./books";
import { inList } from "./sql-helpers";

/**
 * The chart of accounts. Nesting uses parent_account_id with no depth limit.
 * A composite foreign key on (book_id, parent_account_id) makes it impossible
 * for an account to have a parent in a different book.
 */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookId: uuid("book_id")
      .notNull()
      .references(() => books.id, { onDelete: "cascade" }),
    parentAccountId: uuid("parent_account_id"),
    code: text("code"),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull(),
    subtype: text("subtype").notNull(),
    /** Created by the app (for example Opening Balance Equity); cannot be archived. */
    isSystem: boolean("is_system").notNull().default(false),
    /** Stable handle for system accounts so code never looks them up by name. */
    systemRole: text("system_role"),
    /** False for bucket parents, so the parent always equals the sum of its buckets. */
    allowsPosting: boolean("allows_posting").notNull().default(true),
    bucketsEnabled: boolean("buckets_enabled").notNull().default(false),
    isBucket: boolean("is_bucket").notNull().default(false),
    /** The one bucket per parent that deposits land in until they are allocated. */
    isUnassigned: boolean("is_unassigned").notNull().default(false),
    /** Bucket goal: a target amount, optionally by a date. */
    goalCents: bigint("goal_cents", { mode: "number" }),
    goalDate: date("goal_date", { mode: "string" }),
    /** Bucket card color: one of the reserved pastels. */
    color: text("color"),
    sortOrder: integer("sort_order").notNull().default(0),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("accounts_book_id_id_key").on(t.bookId, t.id),
    foreignKey({
      name: "accounts_parent_same_book_fk",
      columns: [t.bookId, t.parentAccountId],
      foreignColumns: [t.bookId, t.id],
    }),
    index("accounts_book_id_idx").on(t.bookId),
    index("accounts_parent_account_id_idx").on(t.parentAccountId),
    uniqueIndex("accounts_book_code_key")
      .on(t.bookId, t.code)
      .where(sql`${t.code} is not null`),
    uniqueIndex("accounts_book_system_role_key")
      .on(t.bookId, t.systemRole)
      .where(sql`${t.systemRole} is not null`),
    // Sibling names must be unique (case-insensitive) within the same type.
    uniqueIndex("accounts_sibling_name_key").on(
      t.bookId,
      t.type,
      sql`coalesce(${t.parentAccountId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${t.name})`,
    ),
    check("accounts_type_check", inList(t.type, ACCOUNT_TYPES)),
    check("accounts_subtype_check", inList(t.subtype, ALL_SUBTYPES)),
    check(
      "accounts_system_role_check",
      sql`${t.systemRole} is null or ${inList(t.systemRole, SYSTEM_ROLES)}`,
    ),
    check(
      "accounts_not_own_parent",
      sql`${t.parentAccountId} is null or ${t.parentAccountId} <> ${t.id}`,
    ),
    check("accounts_name_not_blank", sql`length(trim(${t.name})) > 0`),
    check(
      "accounts_bucket_parent_no_posting",
      sql`not (${t.bucketsEnabled} and ${t.allowsPosting})`,
    ),
    check("accounts_bucket_flags", sql`not (${t.bucketsEnabled} and ${t.isBucket})`),
    check("accounts_unassigned_is_bucket", sql`not ${t.isUnassigned} or ${t.isBucket}`),
    check(
      "accounts_goal_only_buckets",
      sql`(${t.goalCents} is null and ${t.goalDate} is null) or ${t.isBucket}`,
    ),
    check("accounts_goal_positive", sql`${t.goalCents} is null or ${t.goalCents} > 0`),
    check(
      "accounts_color_check",
      sql`${t.color} is null or ${inList(t.color, ["pink", "yellow", "green", "blue"])}`,
    ),
    uniqueIndex("accounts_one_unassigned_key")
      .on(t.parentAccountId)
      .where(sql`${t.isUnassigned}`),
  ],
);
