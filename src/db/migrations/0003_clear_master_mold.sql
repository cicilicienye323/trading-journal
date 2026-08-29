CREATE TYPE "public"."trade_direction" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TYPE "public"."trade_source" AS ENUM('manual', 'import');--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"filename" varchar(255) NOT NULL,
	"row_count" integer NOT NULL,
	"inserted_count" integer NOT NULL,
	"skipped_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"trading_account_id" uuid NOT NULL,
	"import_batch_id" uuid,
	"external_ticket" varchar(40),
	"symbol" varchar(20) NOT NULL,
	"direction" "trade_direction" NOT NULL,
	"volume" numeric(12, 2) NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone NOT NULL,
	"open_price" numeric(18, 5) NOT NULL,
	"close_price" numeric(18, 5) NOT NULL,
	"stop_loss" numeric(18, 5),
	"take_profit" numeric(18, 5),
	"gross_profit" numeric(18, 2) NOT NULL,
	"commission" numeric(18, 2) DEFAULT '0' NOT NULL,
	"swap" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_profit" numeric(18, 2) GENERATED ALWAYS AS (gross_profit + commission + swap) STORED NOT NULL,
	"risk_amount" numeric(18, 2),
	"r_multiple" numeric(10, 3),
	"source" "trade_source" DEFAULT 'manual' NOT NULL,
	"setup_tag" varchar(40),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trades_volume_positive" CHECK ("trades"."volume" > 0),
	CONSTRAINT "trades_open_price_positive" CHECK ("trades"."open_price" > 0),
	CONSTRAINT "trades_close_price_positive" CHECK ("trades"."close_price" > 0),
	CONSTRAINT "trades_closed_after_opened" CHECK ("trades"."closed_at" >= "trades"."opened_at")
);
--> statement-breakpoint
CREATE TABLE "trading_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"name" varchar(80) NOT NULL,
	"broker" varchar(80),
	"account_number" varchar(40),
	"currency" char(3) DEFAULT 'USD' NOT NULL,
	"starting_balance" numeric(18, 2) DEFAULT '0' NOT NULL,
	"server_timezone" varchar(64) DEFAULT 'Europe/Athens' NOT NULL,
	"max_drawdown_limit_pct" numeric(5, 2),
	"daily_loss_limit_pct" numeric(5, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trading_accounts_max_drawdown_pct_range" CHECK ("trading_accounts"."max_drawdown_limit_pct" IS NULL OR ("trading_accounts"."max_drawdown_limit_pct" > 0 AND "trading_accounts"."max_drawdown_limit_pct" <= 100)),
	CONSTRAINT "trading_accounts_daily_loss_pct_range" CHECK ("trading_accounts"."daily_loss_limit_pct" IS NULL OR ("trading_accounts"."daily_loss_limit_pct" > 0 AND "trading_accounts"."daily_loss_limit_pct" <= 100))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_trading_account_id_trading_accounts_id_fk" FOREIGN KEY ("trading_account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_import_batches_user" ON "import_batches" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trades_account_ticket_uniq" ON "trades" USING btree ("trading_account_id","external_ticket") WHERE "trades"."external_ticket" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "trades_user_closed_idx" ON "trades" USING btree ("user_id","closed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_account_closed_idx" ON "trades" USING btree ("trading_account_id","closed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "trades_user_symbol_idx" ON "trades" USING btree ("user_id","symbol");--> statement-breakpoint
CREATE INDEX "idx_trading_accounts_user" ON "trading_accounts" USING btree ("user_id");