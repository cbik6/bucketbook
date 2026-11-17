CREATE TABLE "journal_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"entry_number" integer NOT NULL,
	"kind" text NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"reverses_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entries_book_id_id_key" UNIQUE("book_id","id"),
	CONSTRAINT "journal_entries_book_number_key" UNIQUE("book_id","entry_number"),
	CONSTRAINT "journal_entries_kind_check" CHECK ("journal_entries"."kind" in ('manual', 'opening_balance', 'reversal')),
	CONSTRAINT "journal_entries_version_positive" CHECK ("journal_entries"."current_version" >= 1),
	CONSTRAINT "journal_entries_number_positive" CHECK ("journal_entries"."entry_number" >= 1),
	CONSTRAINT "journal_entries_reversal_link" CHECK (("journal_entries"."kind" = 'reversal') = ("journal_entries"."reverses_entry_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "journal_entry_versions" (
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"entry_date" date NOT NULL,
	"memo" text,
	"change_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_entry_versions_entry_id_version_pk" PRIMARY KEY("entry_id","version")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"line_number" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"debit_cents" bigint DEFAULT 0 NOT NULL,
	"credit_cents" bigint DEFAULT 0 NOT NULL,
	"memo" text,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journal_lines_entry_version_line_key" UNIQUE("entry_id","version","line_number"),
	CONSTRAINT "journal_lines_debit_nonnegative" CHECK ("journal_lines"."debit_cents" >= 0),
	CONSTRAINT "journal_lines_credit_nonnegative" CHECK ("journal_lines"."credit_cents" >= 0),
	CONSTRAINT "journal_lines_one_side" CHECK (("journal_lines"."debit_cents" > 0) <> ("journal_lines"."credit_cents" > 0))
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reverses_fk" FOREIGN KEY ("book_id","reverses_entry_id") REFERENCES "public"."journal_entries"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_versions" ADD CONSTRAINT "journal_entry_versions_entry_id_journal_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entry_versions" ADD CONSTRAINT "journal_entry_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entry_fk" FOREIGN KEY ("book_id","entry_id") REFERENCES "public"."journal_entries"("book_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_version_fk" FOREIGN KEY ("entry_id","version") REFERENCES "public"."journal_entry_versions"("entry_id","version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_one_reversal_key" ON "journal_entries" USING btree ("reverses_entry_id") WHERE "journal_entries"."reverses_entry_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_one_opening_key" ON "journal_entries" USING btree ("book_id") WHERE "journal_entries"."kind" = 'opening_balance';--> statement-breakpoint
CREATE INDEX "journal_entries_book_date_idx" ON "journal_entries" USING btree ("book_id","entry_date");--> statement-breakpoint
CREATE INDEX "journal_lines_entry_idx" ON "journal_lines" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "journal_lines_current_account_idx" ON "journal_lines" USING btree ("account_id") WHERE "journal_lines"."is_current";