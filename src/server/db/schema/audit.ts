import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { books } from "./books";

/**
 * Append-only record of every change. before_data and after_data hold the row
 * as JSON so you can see exactly what changed and when, straight from SQL.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bookId: uuid("book_id").references(() => books.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(),
    beforeData: jsonb("before_data"),
    afterData: jsonb("after_data"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_log_book_created_idx").on(t.bookId, t.createdAt),
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
  ],
);
