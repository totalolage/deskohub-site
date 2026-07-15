CREATE TABLE "discount_applications" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7()::text NOT NULL,
	"payment_attempt_id" text NOT NULL,
	"workspace_reservation_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"public_discount_id" text NOT NULL,
	"label" text NOT NULL,
	"adjustment" jsonb NOT NULL,
	"product_identity" jsonb NOT NULL,
	"subtotal_before_value" integer NOT NULL,
	"subtotal_before_exponent" integer NOT NULL,
	"subtotal_before_currency" text NOT NULL,
	"applied_amount_value" integer NOT NULL,
	"applied_amount_exponent" integer NOT NULL,
	"applied_amount_currency" text NOT NULL,
	"subtotal_after_value" integer NOT NULL,
	"subtotal_after_exponent" integer NOT NULL,
	"subtotal_after_currency" text NOT NULL,
	"expires_at" timestamp with time zone,
	"countdown_starts_at" timestamp with time zone,
	"provenance" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_applications_sequence_check" CHECK ("discount_applications"."sequence" >= 0),
	CONSTRAINT "discount_applications_identity_check" CHECK (btrim("discount_applications"."public_discount_id") <> '' and btrim("discount_applications"."label") <> ''),
	CONSTRAINT "discount_applications_money_values_check" CHECK ("discount_applications"."subtotal_before_value" > 0
        and "discount_applications"."applied_amount_value" > 0
        and "discount_applications"."subtotal_after_value" >= 0
        and "discount_applications"."subtotal_before_value" - "discount_applications"."applied_amount_value" = "discount_applications"."subtotal_after_value"),
	CONSTRAINT "discount_applications_money_exponents_check" CHECK ("discount_applications"."subtotal_before_exponent" >= 0
        and "discount_applications"."subtotal_before_exponent" = "discount_applications"."applied_amount_exponent"
        and "discount_applications"."subtotal_before_exponent" = "discount_applications"."subtotal_after_exponent"),
	CONSTRAINT "discount_applications_money_currencies_check" CHECK ("discount_applications"."subtotal_before_currency" ~ '^[A-Z]{3}$'
        and "discount_applications"."subtotal_before_currency" = "discount_applications"."applied_amount_currency"
        and "discount_applications"."subtotal_before_currency" = "discount_applications"."subtotal_after_currency"),
	CONSTRAINT "discount_applications_countdown_check" CHECK ("discount_applications"."countdown_starts_at" is null or (
        "discount_applications"."expires_at" is not null and "discount_applications"."countdown_starts_at" < "discount_applications"."expires_at"
      ))
);
--> statement-breakpoint
CREATE TABLE "discount_code_redemptions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7()::text NOT NULL,
	"code_id" text NOT NULL,
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
	CONSTRAINT "discount_code_redemptions_customer_check" CHECK (btrim("discount_code_redemptions"."dotypos_customer_id") <> ''),
	CONSTRAINT "discount_code_redemptions_state_check" CHECK ("discount_code_redemptions"."state" in ('reserved', 'redeemed', 'released')),
	CONSTRAINT "discount_code_redemptions_expiration_check" CHECK ("discount_code_redemptions"."reservation_expires_at" > "discount_code_redemptions"."reserved_at"),
	CONSTRAINT "discount_code_redemptions_lifecycle_check" CHECK ((
        "discount_code_redemptions"."state" = 'reserved'
        and "discount_code_redemptions"."redeemed_at" is null
        and "discount_code_redemptions"."released_at" is null
        and "discount_code_redemptions"."release_reason" is null
      ) or (
        "discount_code_redemptions"."state" = 'redeemed'
        and "discount_code_redemptions"."redeemed_at" is not null
        and "discount_code_redemptions"."released_at" is null
        and "discount_code_redemptions"."release_reason" is null
      ) or (
        "discount_code_redemptions"."state" = 'released'
        and "discount_code_redemptions"."redeemed_at" is null
        and "discount_code_redemptions"."released_at" is not null
        and "discount_code_redemptions"."release_reason" is not null
        and btrim("discount_code_redemptions"."release_reason") <> ''
      ))
);
--> statement-breakpoint
CREATE TABLE "discount_code_customers" (
	"code_id" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	CONSTRAINT "discount_code_customers_pk" PRIMARY KEY("code_id","dotypos_customer_id"),
	CONSTRAINT "discount_code_customers_customer_check" CHECK (btrim("discount_code_customers"."dotypos_customer_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "discount_codes" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7()::text NOT NULL,
	"discount_id" text NOT NULL,
	"code" text NOT NULL,
	"enabled" boolean NOT NULL,
	"valid_from" timestamp with time zone,
	"valid_until" timestamp with time zone,
	"max_uses" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discount_codes_code_check" CHECK ("discount_codes"."code" ~ '^[A-Z0-9][A-Z0-9_-]{2,63}$'),
	CONSTRAINT "discount_codes_valid_window_check" CHECK ("discount_codes"."valid_from" is null or "discount_codes"."valid_until" is null or "discount_codes"."valid_until" > "discount_codes"."valid_from"),
	CONSTRAINT "discount_codes_max_uses_check" CHECK ("discount_codes"."max_uses" is null or "discount_codes"."max_uses" > 0)
);
--> statement-breakpoint
CREATE TABLE "discount_product_targets" (
	"discount_id" text NOT NULL,
	"product_key" text NOT NULL,
	"product_identity" jsonb NOT NULL,
	CONSTRAINT "discount_product_targets_pk" PRIMARY KEY("discount_id","product_key"),
	CONSTRAINT "discount_product_targets_product_key_check" CHECK (btrim("discount_product_targets"."product_key") <> '')
);
--> statement-breakpoint
CREATE TABLE "discounts" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7()::text NOT NULL,
	"label" text NOT NULL,
	"percentage_basis_points" integer,
	"fixed_amount_value" integer,
	"fixed_amount_exponent" integer,
	"fixed_amount_currency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discounts_label_check" CHECK (btrim("discounts"."label") <> ''),
	CONSTRAINT "discounts_adjustment_variant_check" CHECK ((
        "discounts"."percentage_basis_points" is not null
        and "discounts"."fixed_amount_value" is null
        and "discounts"."fixed_amount_exponent" is null
        and "discounts"."fixed_amount_currency" is null
      ) or (
        "discounts"."percentage_basis_points" is null
        and "discounts"."fixed_amount_value" is not null
        and "discounts"."fixed_amount_exponent" is not null
        and "discounts"."fixed_amount_currency" is not null
      )),
	CONSTRAINT "discounts_percentage_basis_points_check" CHECK ("discounts"."percentage_basis_points" is null or "discounts"."percentage_basis_points" between 1 and 10000),
	CONSTRAINT "discounts_fixed_amount_check" CHECK ("discounts"."fixed_amount_value" is null or (
        "discounts"."fixed_amount_value" > 0
        and "discounts"."fixed_amount_exponent" >= 0
        and "discounts"."fixed_amount_currency" ~ '^[A-Z]{3}$'
      ))
);
--> statement-breakpoint
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_workspace_reservation_id_workspace_reservations_id_fk" FOREIGN KEY ("workspace_reservation_id") REFERENCES "public"."workspace_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_code_id_discount_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."discount_codes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_application_id_discount_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."discount_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_payment_attempt_id_payment_attempts_id_fk" FOREIGN KEY ("payment_attempt_id") REFERENCES "public"."payment_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_application_attempt_fk" FOREIGN KEY ("application_id","payment_attempt_id") REFERENCES "public"."discount_applications"("id","payment_attempt_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_code_customers" ADD CONSTRAINT "discount_code_customers_code_id_discount_codes_id_fk" FOREIGN KEY ("code_id") REFERENCES "public"."discount_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discount_product_targets" ADD CONSTRAINT "discount_product_targets_discount_id_discounts_id_fk" FOREIGN KEY ("discount_id") REFERENCES "public"."discounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_applications_attempt_sequence_unique_idx" ON "discount_applications" USING btree ("payment_attempt_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_applications_id_attempt_unique_idx" ON "discount_applications" USING btree ("id","payment_attempt_id");--> statement-breakpoint
CREATE INDEX "discount_applications_reservation_idx" ON "discount_applications" USING btree ("workspace_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_redemptions_application_unique_idx" ON "discount_code_redemptions" USING btree ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_redemptions_attempt_unique_idx" ON "discount_code_redemptions" USING btree ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_redemptions_active_customer_unique_idx" ON "discount_code_redemptions" USING btree ("code_id","dotypos_customer_id") WHERE "discount_code_redemptions"."state" in ('reserved', 'redeemed');--> statement-breakpoint
CREATE INDEX "discount_code_redemptions_code_state_idx" ON "discount_code_redemptions" USING btree ("code_id","state");--> statement-breakpoint
CREATE INDEX "discount_code_redemptions_stale_reserved_idx" ON "discount_code_redemptions" USING btree ("reservation_expires_at") WHERE "discount_code_redemptions"."state" = 'reserved';--> statement-breakpoint
CREATE UNIQUE INDEX "discount_codes_code_unique_idx" ON "discount_codes" USING btree ("code");--> statement-breakpoint
CREATE INDEX "discount_codes_discount_idx" ON "discount_codes" USING btree ("discount_id");