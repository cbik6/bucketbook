CREATE TABLE "loans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"interest_account_id" uuid NOT NULL,
	"principal_cents" bigint NOT NULL,
	"annual_rate_micro" integer NOT NULL,
	"term_months" integer NOT NULL,
	"first_payment_date" date NOT NULL,
	"payment_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "loans_principal_positive" CHECK ("loans"."principal_cents" > 0),
	CONSTRAINT "loans_rate_range" CHECK ("loans"."annual_rate_micro" between 0 and 1000000),
	CONSTRAINT "loans_term_range" CHECK ("loans"."term_months" between 1 and 600),
	CONSTRAINT "loans_payment_positive" CHECK ("loans"."payment_cents" > 0)
);
--> statement-breakpoint
CREATE TABLE "reconciliation_items" (
	"reconciliation_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"amount_cents" bigint NOT NULL,
	CONSTRAINT "reconciliation_items_reconciliation_id_entry_id_pk" PRIMARY KEY("reconciliation_id","entry_id")
);
--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"statement_balance_cents" bigint NOT NULL,
	"beginning_balance_cents" bigint NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"finished_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliations_status_check" CHECK ("reconciliations"."status" in ('open', 'finished')),
	CONSTRAINT "reconciliations_finished_at" CHECK (("reconciliations"."status" = 'finished') = ("reconciliations"."finished_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loans" ADD CONSTRAINT "loans_interest_account_fk" FOREIGN KEY ("book_id","interest_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_reconciliation_id_reconciliations_id_fk" FOREIGN KEY ("reconciliation_id") REFERENCES "public"."reconciliations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_items" ADD CONSTRAINT "reconciliation_items_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loans_account_key" ON "loans" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliation_items_entry_account_key" ON "reconciliation_items" USING btree ("entry_id","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_one_open_key" ON "reconciliations" USING btree ("account_id") WHERE "reconciliations"."status" = 'open';--> statement-breakpoint
CREATE INDEX "reconciliations_account_date_idx" ON "reconciliations" USING btree ("account_id","statement_date");