ALTER TABLE "discount_applications" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD COLUMN "order_id" text;--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD COLUMN "order_id" text;--> statement-breakpoint
UPDATE "discount_applications" AS application
SET "order_id" = candidate."order_id"
FROM (
  SELECT
    application_row."id" AS "application_id",
    COALESCE(attempt."order_id", application_row."workspace_reservation_id") AS "order_id"
  FROM "discount_applications" AS application_row
  LEFT JOIN "payment_attempts" AS attempt
    ON attempt."id" = application_row."payment_attempt_id"
  INNER JOIN "orders" AS parent_order
    ON parent_order."id" = COALESCE(attempt."order_id", application_row."workspace_reservation_id")
) AS candidate
WHERE application."id" = candidate."application_id"
  AND application."order_id" IS NULL;--> statement-breakpoint
UPDATE "discount_code_redemptions" AS claim
SET "order_id" = application."order_id"
FROM "discount_applications" AS application
WHERE application."id" = claim."application_id"
  AND claim."order_id" IS NULL
  AND application."order_id" IS NOT NULL;--> statement-breakpoint
UPDATE "voucher_redemptions" AS claim
SET "order_id" = application."order_id"
FROM "discount_applications" AS application
WHERE application."id" = claim."application_id"
  AND claim."order_id" IS NULL
  AND application."order_id" IS NOT NULL;--> statement-breakpoint
UPDATE "legal_evidence_events" AS evidence
SET "order_id" = parent_order."id"
FROM "orders" AS parent_order
WHERE parent_order."id" = evidence."workspace_reservation_id"
  AND evidence."order_id" IS NULL;--> statement-breakpoint
ALTER TABLE "discount_applications" ALTER COLUMN "payment_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_applications" ALTER COLUMN "workspace_reservation_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ALTER COLUMN "payment_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ALTER COLUMN "reservation_expires_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ALTER COLUMN "payment_attempt_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ALTER COLUMN "reservation_expires_at" DROP NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "discount_applications_issued_order_sequence_unique_idx" ON "discount_applications" ("order_id","sequence") WHERE "payment_attempt_id" is null;--> statement-breakpoint
CREATE INDEX "discount_applications_order_idx" ON "discount_applications" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discount_code_redemptions_issued_order_unique_idx" ON "discount_code_redemptions" ("order_id") WHERE "payment_attempt_id" is null;--> statement-breakpoint
CREATE INDEX "discount_code_redemptions_order_idx" ON "discount_code_redemptions" ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voucher_redemptions_issued_order_unique_idx" ON "voucher_redemptions" ("order_id") WHERE "payment_attempt_id" is null;--> statement-breakpoint
CREATE INDEX "voucher_redemptions_order_idx" ON "voucher_redemptions" ("order_id");--> statement-breakpoint
CREATE INDEX "legal_evidence_events_order_idx" ON "legal_evidence_events" ("order_id");--> statement-breakpoint
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id");--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_order_id_orders_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "discount_applications" ADD CONSTRAINT "discount_applications_ownership_check" CHECK ((
        "payment_attempt_id" is not null
        and "workspace_reservation_id" is not null
        and ("order_id" is null or "order_id" = "workspace_reservation_id")
      ) or (
        "order_id" is not null
        and "payment_attempt_id" is null
        and "workspace_reservation_id" is null
      ));--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" ADD CONSTRAINT "discount_code_redemptions_ownership_check" CHECK ((
        "payment_attempt_id" is not null
        and "reservation_expires_at" is not null
      ) or (
        "order_id" is not null
        and "payment_attempt_id" is null
        and "reservation_expires_at" is null
        and "state" = 'redeemed'
      ));--> statement-breakpoint
ALTER TABLE "voucher_redemptions" ADD CONSTRAINT "voucher_redemptions_ownership_check" CHECK ((
        "payment_attempt_id" is not null
        and "reservation_expires_at" is not null
      ) or (
        "order_id" is not null
        and "payment_attempt_id" is null
        and "reservation_expires_at" is null
        and "state" = 'redeemed'
      ));--> statement-breakpoint
ALTER TABLE "legal_evidence_events" ADD CONSTRAINT "legal_evidence_events_order_ownership_check" CHECK ("order_id" is not null or "workspace_reservation_id" is not null);--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" DROP CONSTRAINT "discount_code_redemptions_expiration_check", ADD CONSTRAINT "discount_code_redemptions_expiration_check" CHECK ("reservation_expires_at" is null or "reservation_expires_at" > "reserved_at");--> statement-breakpoint
ALTER TABLE "discount_code_redemptions" DROP CONSTRAINT "discount_code_redemptions_lifecycle_check", ADD CONSTRAINT "discount_code_redemptions_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "reservation_expires_at" is not null
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
      ));--> statement-breakpoint
ALTER TABLE "voucher_redemptions" DROP CONSTRAINT "voucher_redemptions_expiration_check", ADD CONSTRAINT "voucher_redemptions_expiration_check" CHECK ("reservation_expires_at" is null or "reservation_expires_at" > "reserved_at");--> statement-breakpoint
ALTER TABLE "voucher_redemptions" DROP CONSTRAINT "voucher_redemptions_lifecycle_check", ADD CONSTRAINT "voucher_redemptions_lifecycle_check" CHECK ((
        "state" = 'reserved'
        and "reservation_expires_at" is not null
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
      ));
