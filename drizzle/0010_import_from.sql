ALTER TABLE "bank_feeds" ADD COLUMN "import_from" date;--> statement-breakpoint
-- Accounts already connected bring in transactions from today on.
UPDATE "bank_feeds" SET "import_from" = CURRENT_DATE WHERE "account_id" IS NOT NULL;
