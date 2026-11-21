CREATE TABLE "opening_balances" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"book_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"balance_cents" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "journal_entries_one_opening_key";--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opening_balances" ADD CONSTRAINT "opening_balances_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "opening_balances_book_idx" ON "opening_balances" USING btree ("book_id");--> statement-breakpoint
-- Anchors for what's already there, so no balance changes: each account in a live
-- (unreversed) opening entry is anchored on that entry's date at its amount. Nothing
-- could be dated before the start date until now, so the amount is the balance then.
INSERT INTO "opening_balances" ("account_id", "book_id", "as_of", "balance_cents")
SELECT l.account_id, e.book_id, e.entry_date,
       CASE WHEN a.type = 'asset' THEN sum(l.debit_cents - l.credit_cents)
            ELSE -sum(l.debit_cents - l.credit_cents) END
FROM journal_entries e
JOIN journal_lines l ON l.entry_id = e.id AND l.version = e.current_version AND l.is_current
JOIN accounts a ON a.id = l.account_id
WHERE e.kind = 'opening_balance'
  AND NOT EXISTS (SELECT 1 FROM journal_entries r WHERE r.reverses_entry_id = e.id)
  AND a.system_role IS DISTINCT FROM 'opening_balance_equity'
GROUP BY l.account_id, e.book_id, e.entry_date, a.type
ON CONFLICT ("account_id") DO NOTHING;--> statement-breakpoint
-- Bank-connected accounts with no opening amount started at zero on the start date.
INSERT INTO "opening_balances" ("account_id", "book_id", "as_of", "balance_cents")
SELECT DISTINCT f.account_id, f.book_id, b.start_date, 0::bigint
FROM bank_feeds f
JOIN books b ON b.id = f.book_id
JOIN accounts a ON a.id = f.account_id
WHERE f.account_id IS NOT NULL AND a.subtype <> 'investment'
ON CONFLICT ("account_id") DO NOTHING;
