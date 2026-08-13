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
CREATE TABLE "promotion_code_customers" (
	"promotion_code_id" text,
	"dotypos_customer_id" text,
	CONSTRAINT "promotion_code_customers_pk" PRIMARY KEY("promotion_code_id","dotypos_customer_id"),
	CONSTRAINT "promotion_code_customers_customer_check" CHECK (btrim("dotypos_customer_id") <> '')
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
INSERT INTO "promotion_code_customers" ("promotion_code_id", "dotypos_customer_id")
SELECT "code_id", "dotypos_customer_id"
FROM "discount_code_customers";
--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "promotion_code_id" text;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD COLUMN "promotion_kind" text DEFAULT 'discount' NOT NULL;--> statement-breakpoint
UPDATE "discount_codes" SET "promotion_code_id" = "id";--> statement-breakpoint
ALTER TABLE "discount_codes" ALTER COLUMN "promotion_code_id" SET NOT NULL;--> statement-breakpoint
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
ALTER TABLE "promotion_code_customers" ADD CONSTRAINT "promotion_code_customers_nUyZKIbJHnBQ_fkey" FOREIGN KEY ("promotion_code_id") REFERENCES "promotion_codes"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vouchers" ADD CONSTRAINT "vouchers_promotion_fk" FOREIGN KEY ("promotion_code_id","promotion_kind") REFERENCES "promotion_codes"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_promotion_kind_check" CHECK ("promotion_kind" = 'discount');--> statement-breakpoint
CREATE FUNCTION "sync_discount_code_to_promotion"() RETURNS trigger AS $$
BEGIN
	IF NEW."promotion_code_id" IS NULL THEN
		NEW."promotion_code_id" := NEW."id";
	END IF;

	INSERT INTO "promotion_codes" (
		"id", "kind", "code", "enabled", "valid_from", "valid_until", "created_at", "updated_at"
	) VALUES (
		NEW."promotion_code_id", 'discount', NEW."code", NEW."enabled", NEW."valid_from", NEW."valid_until", NEW."created_at", NEW."updated_at"
	)
	ON CONFLICT ("id") DO UPDATE SET
		"code" = EXCLUDED."code",
		"enabled" = EXCLUDED."enabled",
		"valid_from" = EXCLUDED."valid_from",
		"valid_until" = EXCLUDED."valid_until",
		"updated_at" = EXCLUDED."updated_at"
	WHERE "promotion_codes"."kind" = 'discount'
		AND ROW(
			"promotion_codes"."code",
			"promotion_codes"."enabled",
			"promotion_codes"."valid_from",
			"promotion_codes"."valid_until",
			"promotion_codes"."updated_at"
		) IS DISTINCT FROM ROW(
			EXCLUDED."code",
			EXCLUDED."enabled",
			EXCLUDED."valid_from",
			EXCLUDED."valid_until",
			EXCLUDED."updated_at"
		);

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "discount_codes_sync_promotion_trigger"
BEFORE INSERT OR UPDATE OF "code", "enabled", "valid_from", "valid_until", "updated_at"
ON "discount_codes"
FOR EACH ROW EXECUTE FUNCTION "sync_discount_code_to_promotion"();--> statement-breakpoint
CREATE FUNCTION "sync_promotion_to_discount_code"() RETURNS trigger AS $$
BEGIN
	IF NEW."kind" = 'discount' THEN
		UPDATE "discount_codes"
		SET
			"code" = NEW."code",
			"enabled" = NEW."enabled",
			"valid_from" = NEW."valid_from",
			"valid_until" = NEW."valid_until",
			"updated_at" = NEW."updated_at"
		WHERE "promotion_code_id" = NEW."id"
			AND ROW("code", "enabled", "valid_from", "valid_until", "updated_at")
				IS DISTINCT FROM ROW(NEW."code", NEW."enabled", NEW."valid_from", NEW."valid_until", NEW."updated_at");
	END IF;

	RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "promotion_codes_sync_discount_trigger"
AFTER UPDATE OF "code", "enabled", "valid_from", "valid_until", "updated_at"
ON "promotion_codes"
FOR EACH ROW EXECUTE FUNCTION "sync_promotion_to_discount_code"();--> statement-breakpoint
CREATE FUNCTION "delete_discount_promotion"() RETURNS trigger AS $$
BEGIN
	DELETE FROM "promotion_codes"
	WHERE "id" = OLD."promotion_code_id" AND "kind" = 'discount';
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "discount_codes_delete_promotion_trigger"
AFTER DELETE ON "discount_codes"
FOR EACH ROW EXECUTE FUNCTION "delete_discount_promotion"();--> statement-breakpoint
CREATE FUNCTION "sync_legacy_discount_code_customer"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "promotion_code_customers" ("promotion_code_id", "dotypos_customer_id")
		SELECT "promotion_code_id", NEW."dotypos_customer_id"
		FROM "discount_codes"
		WHERE "id" = NEW."code_id"
		ON CONFLICT DO NOTHING;
		RETURN NEW;
	END IF;

	DELETE FROM "promotion_code_customers"
	WHERE "promotion_code_id" = (
		SELECT "promotion_code_id" FROM "discount_codes" WHERE "id" = OLD."code_id"
	) AND "dotypos_customer_id" = OLD."dotypos_customer_id";
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "discount_code_customers_sync_promotion_trigger"
AFTER INSERT OR DELETE ON "discount_code_customers"
FOR EACH ROW EXECUTE FUNCTION "sync_legacy_discount_code_customer"();--> statement-breakpoint
CREATE FUNCTION "sync_promotion_discount_code_customer"() RETURNS trigger AS $$
BEGIN
	IF TG_OP = 'INSERT' THEN
		INSERT INTO "discount_code_customers" ("code_id", "dotypos_customer_id")
		SELECT "id", NEW."dotypos_customer_id"
		FROM "discount_codes"
		WHERE "promotion_code_id" = NEW."promotion_code_id"
		ON CONFLICT DO NOTHING;
		RETURN NEW;
	END IF;

	DELETE FROM "discount_code_customers"
	WHERE "code_id" = (
		SELECT "id" FROM "discount_codes" WHERE "promotion_code_id" = OLD."promotion_code_id"
	) AND "dotypos_customer_id" = OLD."dotypos_customer_id";
	RETURN OLD;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER "promotion_code_customers_sync_discount_trigger"
AFTER INSERT OR DELETE ON "promotion_code_customers"
FOR EACH ROW EXECUTE FUNCTION "sync_promotion_discount_code_customer"();
