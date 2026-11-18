CREATE TABLE "bucket_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"parent_account_id" uuid NOT NULL,
	"bucket_account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_cents" bigint,
	"percent_bp" integer,
	"min_deposit_cents" bigint,
	"priority" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_run_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bucket_rules_kind_check" CHECK ("bucket_rules"."kind" in ('percent', 'fixed', 'monthly')),
	CONSTRAINT "bucket_rules_amount_shape" CHECK (("bucket_rules"."kind" = 'percent' and "bucket_rules"."percent_bp" between 1 and 10000 and "bucket_rules"."amount_cents" is null)
        or ("bucket_rules"."kind" in ('fixed', 'monthly') and "bucket_rules"."amount_cents" > 0 and "bucket_rules"."percent_bp" is null))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_kind_check";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "is_unassigned" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "goal_cents" bigint;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "goal_date" date;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "color" text;--> statement-breakpoint
ALTER TABLE "bucket_rules" ADD CONSTRAINT "bucket_rules_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_rules" ADD CONSTRAINT "bucket_rules_parent_fk" FOREIGN KEY ("book_id","parent_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bucket_rules" ADD CONSTRAINT "bucket_rules_bucket_fk" FOREIGN KEY ("book_id","bucket_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bucket_rules_parent_idx" ON "bucket_rules" USING btree ("parent_account_id","priority");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_one_unassigned_key" ON "accounts" USING btree ("parent_account_id") WHERE "accounts"."is_unassigned";--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_unassigned_is_bucket" CHECK (not "accounts"."is_unassigned" or "accounts"."is_bucket");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_goal_only_buckets" CHECK (("accounts"."goal_cents" is null and "accounts"."goal_date" is null) or "accounts"."is_bucket");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_goal_positive" CHECK ("accounts"."goal_cents" is null or "accounts"."goal_cents" > 0);--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_color_check" CHECK ("accounts"."color" is null or "accounts"."color" in ('pink', 'yellow', 'green', 'blue'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_kind_check" CHECK ("journal_entries"."kind" in ('manual', 'opening_balance', 'reversal', 'bank', 'transfer', 'bucket'));