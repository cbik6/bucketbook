CREATE TABLE "budgets" (
	"book_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"month" date NOT NULL,
	"amount_cents" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budgets_account_id_month_pk" PRIMARY KEY("account_id","month"),
	CONSTRAINT "budgets_month_first_day" CHECK (extract(day from "budgets"."month") = 1),
	CONSTRAINT "budgets_amount_nonnegative" CHECK ("budgets"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_account_fk" FOREIGN KEY ("book_id","account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE cascade ON UPDATE no action;