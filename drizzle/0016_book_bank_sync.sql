ALTER TABLE "books" ADD COLUMN "bank_sync_every_hours" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "bank_sync_hour" integer DEFAULT 6 NOT NULL;--> statement-breakpoint
-- The sync hour moves from each connection to its book: keep the hour of the book's first connection.
UPDATE "books" SET "bank_sync_hour" = c."sync_hour"
FROM (
  SELECT DISTINCT ON ("book_id") "book_id", "sync_hour"
  FROM "simplefin_connections"
  ORDER BY "book_id", "created_at"
) AS c
WHERE c."book_id" = "books"."id";--> statement-breakpoint
ALTER TABLE "simplefin_connections" DROP CONSTRAINT "simplefin_connections_sync_hour";--> statement-breakpoint
ALTER TABLE "simplefin_connections" DROP COLUMN "sync_hour";--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_bank_sync_every_hours_check" CHECK ("books"."bank_sync_every_hours" in (0, 4, 6, 12, 24));--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_bank_sync_hour_check" CHECK ("books"."bank_sync_hour" between 0 and 23);
