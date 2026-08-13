CREATE TABLE "voucher_redemptions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"voucher_id" text NOT NULL,
	"application_id" text NOT NULL,
	"payment_attempt_id" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"state" text NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voucher_redemptions_customer_check" CHECK (btrim("dotypos_customer_id") <> ''),
	CONSTRAINT "voucher_redemptions_state_check" CHECK ("state" in ('reserved', 'redeemed', 'released')),
	CONSTRAINT "voucher_redemptions_expiration_check" CHECK ("reservation_expires_at" > "reserved_at"),
	CONSTRAINT "voucher_redemptions_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "redeemed_at" is null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'redeemed'
        and "redeemed_at" is not null
        and "released_at" is null
        and "release_reason" is null
      ) or (
        "state" = 'released'
        and "redeemed_at" is null
        and "released_at" is not null
        and "release_reason" is not null
        and btrim("release_reason") <> ''
      ))
);
--> statement-breakpoint
CREATE TABLE "promotion_codes" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_codes_code_check" CHECK ("code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
	CONSTRAINT "promotion_codes_valid_window_check" CHECK ("valid_from" is null or "valid_until" is null or "valid_until" > "valid_from"),
	CONSTRAINT "promotion_codes_kind_check" CHECK ("kind" in ('discount', 'voucher'))
);
--> statement-breakpoint
CREATE TABLE "vouchers" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"promotion_code_id" text NOT NULL UNIQUE,
	"promotion_kind" text DEFAULT 'voucher' NOT NULL,
	"issued_amount_value" integer NOT NULL,
	"issued_amount_exponent" integer NOT NULL,
	"issued_amount_currency" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_promotion_kind_check" CHECK ("promotion_kind" = 'voucher'),
	CONSTRAINT "vouchers_issued_amount_check" CHECK ("issued_amount_value" > 0 and "issued_amount_exponent" >= 0 and "issued_amount_currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
INSERT INTO "promotion_codes" (
	"id", "kind", "code", "enabled", "valid_from", "valid_until", "created_at", "updated_at"
)
SELECT "id", 'discount', "code", "enabled", "valid_from", "valid_until", "created_at", "updated_at"
FROM "discount_codes";
--> statement-breakpoint
ALTER TABLE "discount_code_customers" RENAME TO "promotion_code_customers";--> statement-breakpoint
ALTER TABLE "promotion_code_customers" RENAME COLUMN "code_id" TO "promotion_code_id";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_code_check";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP CONSTRAINT "discount_codes_valid_window_check";--> statement-breakpoint
ALTER TABLE "promotion_code_customers" RENAME CONSTRAINT "discount_code_customers_customer_check" TO "promotion_code_customers_customer_check";--> statement-breakpoint
DROP INDEX "discount_codes_code_unique_idx";--> statement-breakpoint
ALTER TABLE "promotion_code_customers" RENAME CONSTRAINT "discount_code_customers_code_id_discount_codes_id_fk" TO "promotion_code_customers_nUyZKIbJHnBQ_fkey";--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "promotion_code_id" text;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "promotion_kind" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
UPDATE "discount_codes" SET "promotion_code_id" = "id";--> statement-breakpoint
ALTER TABLE "discount_codes" ALTER COLUMN "promotion_code_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "promotion_code_customers" RENAME CONSTRAINT "discount_code_customers_pk" TO "promotion_code_customers_pk";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP COLUMN "code";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP COLUMN "enabled";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP COLUMN "valid_from";--> statement-breakpoint
ALTER TABLE "discount_codes" DROP COLUMN "valid_until";--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_promotion_code_id_key" UNIQUE("promotion_code_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_redemptions_application_unique_idx" ON "voucher_redemptions" ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_redemptions_attempt_unique_idx" ON "voucher_redemptions" ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_redemptions_active_customer_unique_idx" ON "voucher_redemptions" ("voucher_id","dotypos_customer_id") WHERE "state" = 'reserved';--> statement-breakpoint
CREATE INDEX "voucher_redemptions_voucher_state_idx" ON "voucher_redemptions" ("voucher_id","state");--> statement-breakpoint
CREATE INDEX "voucher_redemptions_stale_reserved_idx" ON "voucher_redemptions" ("reservation_expires_at") WHERE "state" = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_codes_code_unique_idx" ON "promotion_codes" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_codes_id_kind_unique_idx" ON "promotion_codes" ("id","kind");--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_voucher_id_vouchers_id_fkey" FOREIGN KEY ("voucher_id") REFERENCES "vouchers"("id");--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_upZW4Z72dq9a_fkey" FOREIGN KEY ("application_id") REFERENCES "discount_applications"("id");--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_payment_attempt_id_payment_attempts_id_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id");--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_promotion_fk" FOREIGN KEY ("promotion_code_id","promotion_kind") REFERENCES "promotion_codes"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_promotion_fk" FOREIGN KEY ("promotion_code_id","promotion_kind") REFERENCES "promotion_codes"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "promotion_code_customers" DROP CONSTRAINT "promotion_code_customers_nUyZKIbJHnBQ_fkey", ADD CONSTRAINT "promotion_code_customers_nUyZKIbJHnBQ_fkey" FOREIGN KEY ("promotion_code_id") REFERENCES "promotion_codes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_promotion_kind_check" CHECK ("promotion_kind" = 'discount');
