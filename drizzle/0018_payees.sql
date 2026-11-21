CREATE TABLE "payee_matches" (
	"book_id" uuid NOT NULL,
	"key" text NOT NULL,
	"payee_id" uuid NOT NULL,
	"sample" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payee_matches_book_id_key_pk" PRIMARY KEY("book_id","key")
);
--> statement-breakpoint
CREATE TABLE "payees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"name" text NOT NULL,
	"default_account_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "payee_id" uuid;--> statement-breakpoint
ALTER TABLE "payee_matches" ADD CONSTRAINT "payee_matches_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payee_matches" ADD CONSTRAINT "payee_matches_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payees" ADD CONSTRAINT "payees_default_account_id_accounts_id_fk" FOREIGN KEY ("default_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payee_matches_payee_idx" ON "payee_matches" USING btree ("payee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payees_book_name_key" ON "payees" USING btree ("book_id",lower("name"));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_payee_id_payees_id_fk" FOREIGN KEY ("payee_id") REFERENCES "public"."payees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_payee_idx" ON "journal_entries" USING btree ("payee_id") WHERE "journal_entries"."payee_id" is not null;--> statement-breakpoint
-- Payees from the names already on entries: ones you typed or cleaned up, on entries
-- you wrote or added from review. Raw bank text (an entry whose payee is just its bank
-- transaction's description) stays plain text, so the list starts clean. When the same
-- name is spelled differently, the most used spelling wins.
WITH named AS (
  SELECT e.book_id, btrim(e.payee) AS name, count(*) AS uses
  FROM journal_entries e
  WHERE e.kind IN ('manual', 'bank')
    AND btrim(coalesce(e.payee, '')) <> ''
    AND length(btrim(e.payee)) <= 200
    AND NOT EXISTS (
      SELECT 1 FROM bank_transactions b
      WHERE b.entry_id = e.id
        AND lower(btrim(e.payee)) IN (lower(btrim(b.description)), lower(btrim(coalesce(b.payee, ''))))
    )
  GROUP BY 1, 2
), ranked AS (
  SELECT book_id, name,
         row_number() OVER (PARTITION BY book_id, lower(name) ORDER BY uses DESC, name) AS pick
  FROM named
)
INSERT INTO "payees" ("book_id", "name")
SELECT book_id, name FROM ranked WHERE pick = 1;
--> statement-breakpoint
UPDATE "journal_entries" e
SET "payee_id" = p.id
FROM "payees" p
WHERE p.book_id = e.book_id
  AND lower(p.name) = lower(btrim(e.payee));
