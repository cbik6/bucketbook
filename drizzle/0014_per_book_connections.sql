ALTER TABLE "simplefin_connections" ADD COLUMN "book_id" uuid;--> statement-breakpoint
-- Each connection joins the book most of its accounts feed, or else the oldest book.
UPDATE "simplefin_connections" c SET "book_id" = coalesce(
  (SELECT f."book_id" FROM "bank_feeds" f JOIN "books" b ON b."id" = f."book_id"
    WHERE f."connection_id" = c."id"
    GROUP BY f."book_id", b."created_at"
    ORDER BY count(*) DESC, b."created_at" LIMIT 1),
  (SELECT "id" FROM "books" ORDER BY "created_at" LIMIT 1)
);--> statement-breakpoint
-- Accounts that fed a different book move to a copy of the connection owned by that book.
DO $$
DECLARE r record; copy_id uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT f."connection_id", f."book_id" FROM "bank_feeds" f
    JOIN "simplefin_connections" c ON c."id" = f."connection_id"
    WHERE f."book_id" IS NOT NULL AND f."book_id" <> c."book_id"
  LOOP
    INSERT INTO "simplefin_connections" ("book_id", "label", "access_url_ciphertext", "created_by",
      "sync_hour", "sync_minute", "last_sync_at", "last_sync_status", "last_sync_messages")
    SELECT r."book_id", "label", "access_url_ciphertext", "created_by",
      "sync_hour", "sync_minute", "last_sync_at", "last_sync_status", "last_sync_messages"
    FROM "simplefin_connections" WHERE "id" = r."connection_id"
    RETURNING "id" INTO copy_id;
    UPDATE "bank_feeds" SET "connection_id" = copy_id
    WHERE "connection_id" = r."connection_id" AND "book_id" = r."book_id";
  END LOOP;
END $$;--> statement-breakpoint
-- With no books at all there is nowhere for a connection to live.
DELETE FROM "simplefin_connections" WHERE "book_id" IS NULL;--> statement-breakpoint
ALTER TABLE "simplefin_connections" ALTER COLUMN "book_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "simplefin_connections" ADD CONSTRAINT "simplefin_connections_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connections" ADD CONSTRAINT "simplefin_connections_book_id_id_key" UNIQUE("book_id","id");--> statement-breakpoint
CREATE INDEX "simplefin_connections_book_idx" ON "simplefin_connections" USING btree ("book_id");--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_connection_book_fk" FOREIGN KEY ("book_id","connection_id") REFERENCES "public"."simplefin_connections"("book_id","id") ON DELETE no action ON UPDATE no action;
