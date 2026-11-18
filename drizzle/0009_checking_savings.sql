ALTER TABLE "accounts" DROP CONSTRAINT "accounts_subtype_check";--> statement-breakpoint
-- "Bank" splits into Checking and Savings: accounts named like savings become
-- Savings, every other bank account becomes Checking.
UPDATE "accounts" SET "subtype" = 'savings' WHERE "subtype" = 'bank' AND "name" ILIKE '%sav%';--> statement-breakpoint
UPDATE "accounts" SET "subtype" = 'checking' WHERE "subtype" = 'bank';--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_subtype_check" CHECK ("accounts"."subtype" in ('checking', 'savings', 'cash', 'investment', 'other_current_asset', 'fixed_asset', 'other_asset', 'credit_card', 'loan', 'other_current_liability', 'long_term_liability', 'opening_balance', 'retained_earnings', 'owner_equity', 'other_equity', 'income', 'other_income', 'expense', 'cost_of_goods_sold', 'other_expense'));