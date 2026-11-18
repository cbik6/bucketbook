CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"entry_id" uuid,
	"bank_transaction_id" uuid,
	"file_name" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_one_target" CHECK (num_nonnulls("attachments"."entry_id", "attachments"."bank_transaction_id") = 1),
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_feeds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"connection_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"institution" text,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"book_id" uuid,
	"account_id" uuid,
	"ignored" boolean DEFAULT false NOT NULL,
	"balance_cents" bigint,
	"available_balance_cents" bigint,
	"balance_at" timestamp with time zone,
	"synced_through" date,
	"synced_from" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_feeds_connection_external_key" UNIQUE("connection_id","external_id"),
	CONSTRAINT "bank_feeds_mapping_complete" CHECK (("bank_feeds"."book_id" is null) = ("bank_feeds"."account_id" is null)),
	CONSTRAINT "bank_feeds_ignored_unmapped" CHECK (not ("bank_feeds"."ignored" and "bank_feeds"."account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "bank_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"priority" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"conditions" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_rules_name_not_blank" CHECK (length(trim("bank_rules"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "bank_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"feed_id" uuid,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"import_batch_id" uuid,
	"posted_date" date NOT NULL,
	"transacted_date" date,
	"amount_cents" bigint NOT NULL,
	"description" text NOT NULL,
	"payee" text,
	"bank_memo" text,
	"status" text NOT NULL,
	"post_method" text,
	"entry_id" uuid,
	"duplicate_of_id" uuid,
	"suggested_account_id" uuid,
	"suggested_bucket_id" uuid,
	"suggested_payee" text,
	"suggested_memo" text,
	"suggested_transfer" boolean DEFAULT false NOT NULL,
	"suggested_rule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_transactions_book_id_id_key" UNIQUE("book_id","id"),
	CONSTRAINT "bank_transactions_source_check" CHECK ("bank_transactions"."source" in ('simplefin', 'csv')),
	CONSTRAINT "bank_transactions_status_check" CHECK ("bank_transactions"."status" in ('pending', 'review', 'posted', 'excluded', 'removed')),
	CONSTRAINT "bank_transactions_post_method_check" CHECK ("bank_transactions"."post_method" is null or "bank_transactions"."post_method" in ('approved', 'transfer', 'linked')),
	CONSTRAINT "bank_transactions_amount_nonzero" CHECK ("bank_transactions"."amount_cents" <> 0),
	CONSTRAINT "bank_transactions_posted_link" CHECK (("bank_transactions"."status" = 'posted') = ("bank_transactions"."entry_id" is not null and "bank_transactions"."post_method" is not null))
);
--> statement-breakpoint
CREATE TABLE "book_counterparts" (
	"book_id" uuid NOT NULL,
	"other_book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_counterparts_book_id_other_book_id_pk" PRIMARY KEY("book_id","other_book_id"),
	CONSTRAINT "book_counterparts_other_book" CHECK ("book_counterparts"."book_id" <> "book_counterparts"."other_book_id")
);
--> statement-breakpoint
CREATE TABLE "csv_presets" (
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"mapping" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "csv_presets_account_id_pk" PRIMARY KEY("account_id")
);
--> statement-breakpoint
CREATE TABLE "simplefin_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"access_url_ciphertext" text NOT NULL,
	"created_by" uuid,
	"sync_hour" integer DEFAULT 6 NOT NULL,
	"sync_minute" integer DEFAULT 17 NOT NULL,
	"sync_started_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_sync_status" text,
	"last_sync_messages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simplefin_connections_sync_hour" CHECK ("simplefin_connections"."sync_hour" between 0 and 23),
	CONSTRAINT "simplefin_connections_sync_minute" CHECK ("simplefin_connections"."sync_minute" between 0 and 59),
	CONSTRAINT "simplefin_connections_status_check" CHECK ("simplefin_connections"."last_sync_status" is null or "simplefin_connections"."last_sync_status" in ('ok', 'warning', 'error'))
);
--> statement-breakpoint
CREATE TABLE "simplefin_requests" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"connection_id" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"window_start" date,
	"window_end" date,
	"ok" boolean NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_kind_check";--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "payee" text;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "transfer_group_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entry_versions" ADD COLUMN "payee" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_entry_fk" FOREIGN KEY ("book_id","entry_id") REFERENCES "public"."journal_entries"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_bank_tx_fk" FOREIGN KEY ("book_id","bank_transaction_id") REFERENCES "public"."bank_transactions"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_connection_id_simplefin_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."simplefin_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_feeds" ADD CONSTRAINT "bank_feeds_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_feed_id_bank_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "public"."bank_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_entry_fk" FOREIGN KEY ("book_id","entry_id") REFERENCES "public"."journal_entries"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_duplicate_fk" FOREIGN KEY ("duplicate_of_id") REFERENCES "public"."bank_transactions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_counterparts" ADD CONSTRAINT "book_counterparts_other_book_id_books_id_fk" FOREIGN KEY ("other_book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_counterparts" ADD CONSTRAINT "book_counterparts_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_presets" ADD CONSTRAINT "csv_presets_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_connections" ADD CONSTRAINT "simplefin_connections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simplefin_requests" ADD CONSTRAINT "simplefin_requests_connection_id_simplefin_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."simplefin_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_entry_idx" ON "attachments" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "attachments_bank_tx_idx" ON "attachments" USING btree ("bank_transaction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_feeds_account_key" ON "bank_feeds" USING btree ("account_id") WHERE "bank_feeds"."account_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_rules_book_priority_idx" ON "bank_rules" USING btree ("book_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_feed_external_key" ON "bank_transactions" USING btree ("feed_id","external_id") WHERE "bank_transactions"."source" = 'simplefin' and "bank_transactions"."feed_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_csv_external_key" ON "bank_transactions" USING btree ("account_id","external_id") WHERE "bank_transactions"."source" = 'csv';--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transactions_entry_account_key" ON "bank_transactions" USING btree ("entry_id","account_id") WHERE "bank_transactions"."entry_id" is not null;--> statement-breakpoint
CREATE INDEX "bank_transactions_book_status_idx" ON "bank_transactions" USING btree ("book_id","status","posted_date");--> statement-breakpoint
CREATE INDEX "bank_transactions_account_date_idx" ON "bank_transactions" USING btree ("account_id","posted_date");--> statement-breakpoint
CREATE INDEX "simplefin_requests_connection_time_idx" ON "simplefin_requests" USING btree ("connection_id","requested_at");--> statement-breakpoint
CREATE INDEX "journal_entries_transfer_group_idx" ON "journal_entries" USING btree ("transfer_group_id") WHERE "journal_entries"."transfer_group_id" is not null;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_kind_check" CHECK ("journal_entries"."kind" in ('manual', 'opening_balance', 'reversal', 'bank', 'transfer'));