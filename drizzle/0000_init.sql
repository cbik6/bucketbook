CREATE TABLE "auth_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "auth_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "book_members" (
	"book_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "book_members_book_id_user_id_pk" PRIMARY KEY("book_id","user_id"),
	CONSTRAINT "book_members_role_check" CHECK ("book_members"."role" in ('owner', 'editor', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "books" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"template" text NOT NULL,
	"start_date" date NOT NULL,
	"currency_code" char(3) DEFAULT 'USD' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "books_template_check" CHECK ("books"."template" in ('household', 'small_business', 'blank')),
	CONSTRAINT "books_currency_code_check" CHECK ("books"."currency_code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "books_name_not_blank" CHECK (length(trim("books"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"book_id" uuid NOT NULL,
	"parent_account_id" uuid,
	"code" text,
	"name" text NOT NULL,
	"description" text,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_role" text,
	"allows_posting" boolean DEFAULT true NOT NULL,
	"buckets_enabled" boolean DEFAULT false NOT NULL,
	"is_bucket" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_book_id_id_key" UNIQUE("book_id","id"),
	CONSTRAINT "accounts_type_check" CHECK ("accounts"."type" in ('asset', 'liability', 'equity', 'income', 'expense')),
	CONSTRAINT "accounts_subtype_check" CHECK ("accounts"."subtype" in ('bank', 'cash', 'other_current_asset', 'fixed_asset', 'other_asset', 'credit_card', 'loan', 'other_current_liability', 'long_term_liability', 'opening_balance', 'retained_earnings', 'owner_equity', 'other_equity', 'income', 'other_income', 'expense', 'cost_of_goods_sold', 'other_expense')),
	CONSTRAINT "accounts_system_role_check" CHECK ("accounts"."system_role" is null or "accounts"."system_role" in ('opening_balance_equity', 'retained_earnings')),
	CONSTRAINT "accounts_not_own_parent" CHECK ("accounts"."parent_account_id" is null or "accounts"."parent_account_id" <> "accounts"."id"),
	CONSTRAINT "accounts_name_not_blank" CHECK (length(trim("accounts"."name")) > 0),
	CONSTRAINT "accounts_bucket_parent_no_posting" CHECK (not ("accounts"."buckets_enabled" and "accounts"."allows_posting")),
	CONSTRAINT "accounts_bucket_flags" CHECK (not ("accounts"."buckets_enabled" and "accounts"."is_bucket"))
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"book_id" uuid,
	"user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"before_data" jsonb,
	"after_data" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD CONSTRAINT "auth_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_members" ADD CONSTRAINT "book_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_same_book_fk" FOREIGN KEY ("book_id","parent_account_id") REFERENCES "public"."accounts"("book_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_accounts_user_id_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_user_id_idx" ON "auth_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verifications_identifier_idx" ON "auth_verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "book_members_user_id_idx" ON "book_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "accounts_book_id_idx" ON "accounts" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_account_id_idx" ON "accounts" USING btree ("parent_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_code_key" ON "accounts" USING btree ("book_id","code") WHERE "accounts"."code" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_book_system_role_key" ON "accounts" USING btree ("book_id","system_role") WHERE "accounts"."system_role" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_sibling_name_key" ON "accounts" USING btree ("book_id","type",coalesce("parent_account_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "audit_log_book_created_idx" ON "audit_log" USING btree ("book_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_entity_idx" ON "audit_log" USING btree ("entity_type","entity_id");