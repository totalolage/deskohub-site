CREATE TABLE "referral_attributions" (
	"invited_dotypos_customer_id" text,
	"referrer_dotypos_customer_id" text NOT NULL,
	"promotion_code_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_attributions_invited_customer_pk" PRIMARY KEY("invited_dotypos_customer_id"),
	CONSTRAINT "referral_attributions_customer_check" CHECK (btrim("invited_dotypos_customer_id") <> '' and btrim("referrer_dotypos_customer_id") <> ''),
	CONSTRAINT "referral_attributions_self_check" CHECK ("invited_dotypos_customer_id" <> "referrer_dotypos_customer_id")
);
--> statement-breakpoint
CREATE TABLE "referral_codes" (
	"promotion_code_id" text PRIMARY KEY,
	"promotion_kind" text DEFAULT 'referral' NOT NULL,
	"referrer_dotypos_customer_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_codes_promotion_kind_check" CHECK ("promotion_kind" = 'referral'),
	CONSTRAINT "referral_codes_referrer_check" CHECK (btrim("referrer_dotypos_customer_id") <> '')
);
--> statement-breakpoint
CREATE TABLE "referral_invitation_claims" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"invited_dotypos_customer_id" text NOT NULL,
	"application_id" text NOT NULL,
	"payment_attempt_id" text NOT NULL,
	"state" text NOT NULL,
	"reservation_expires_at" timestamp with time zone NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"redeemed_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"release_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "referral_invitation_claims_customer_check" CHECK (btrim("invited_dotypos_customer_id") <> ''),
	CONSTRAINT "referral_invitation_claims_state_check" CHECK ("state" in ('reserved', 'redeemed', 'released')),
	CONSTRAINT "referral_invitation_claims_expiration_check" CHECK ("reservation_expires_at" > "reserved_at"),
	CONSTRAINT "referral_invitation_claims_lifecycle_check" CHECK ((
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
CREATE UNIQUE INDEX "discount_applications_id_attempt_unique_idx" ON "discount_applications" ("id","payment_attempt_id");--> statement-breakpoint
CREATE INDEX "referral_attributions_referrer_idx" ON "referral_attributions" ("referrer_dotypos_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_referrer_unique_idx" ON "referral_codes" ("referrer_dotypos_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_codes_id_referrer_unique_idx" ON "referral_codes" ("promotion_code_id","referrer_dotypos_customer_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_invitation_claims_application_unique_idx" ON "referral_invitation_claims" ("application_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_invitation_claims_attempt_unique_idx" ON "referral_invitation_claims" ("payment_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "referral_invitation_claims_active_customer_unique_idx" ON "referral_invitation_claims" ("invited_dotypos_customer_id") WHERE "state" in ('reserved', 'redeemed');--> statement-breakpoint
CREATE INDEX "referral_invitation_claims_stale_reserved_idx" ON "referral_invitation_claims" ("reservation_expires_at") WHERE "state" = 'reserved';--> statement-breakpoint
ALTER TABLE "referral_attributions" ADD CONSTRAINT "referral_attributions_code_referrer_fk" FOREIGN KEY ("promotion_code_id","referrer_dotypos_customer_id") REFERENCES "referral_codes"("promotion_code_id","referrer_dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "referral_codes" ADD CONSTRAINT "referral_codes_promotion_fk" FOREIGN KEY ("promotion_code_id","promotion_kind") REFERENCES "promotion_codes"("id","kind") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD CONSTRAINT "referral_invitation_claims_DNDgiDyFCKlU_fkey" FOREIGN KEY ("invited_dotypos_customer_id") REFERENCES "referral_attributions"("invited_dotypos_customer_id");--> statement-breakpoint
ALTER TABLE "referral_invitation_claims" ADD CONSTRAINT "referral_invitation_claims_application_attempt_fk" FOREIGN KEY ("application_id","payment_attempt_id") REFERENCES "discount_applications"("id","payment_attempt_id");--> statement-breakpoint
ALTER TABLE "promotion_codes" DROP CONSTRAINT "promotion_codes_kind_check", ADD CONSTRAINT "promotion_codes_kind_check" CHECK ("kind" in ('discount', 'voucher', 'referral'));