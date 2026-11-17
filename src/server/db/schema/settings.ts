import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Install-wide settings as key/value pairs, for example `setup_completed_at`. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
