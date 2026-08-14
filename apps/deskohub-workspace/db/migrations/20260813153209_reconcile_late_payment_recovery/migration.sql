CREATE TABLE IF NOT EXISTS "late_payment_recoveries" (
	"payment_attempt_id" text PRIMARY KEY,
	"workspace_reservation_id" text NOT NULL,
	"webhook_event_id" text NOT NULL,
	"provider_operation_id" text,
	"provider_status" text,
	"state" text NOT NULL,
	"original_dotypos_reservation_id" text NOT NULL,
	"recovered_dotypos_reservation_id" text,
	"failure_code" text,
	"verified_paid_at" timestamp with time zone NOT NULL,
	"claimed_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "late_payment_recoveries_state_check" CHECK ("state" in ('pending', 'processing', 'recovered', 'refund_required', 'review_required')),
	CONSTRAINT "late_payment_recoveries_completion_check" CHECK (("state" in ('pending', 'processing') and "completed_at" is null) or ("state" in ('recovered', 'refund_required', 'review_required') and "completed_at" is not null)),
	CONSTRAINT "late_payment_recoveries_recovered_booking_check" CHECK ("state" <> 'recovered' or "recovered_dotypos_reservation_id" is not null),
	CONSTRAINT "late_payment_recoveries_failure_check" CHECK ("state" not in ('refund_required', 'review_required') or ("failure_code" is not null and btrim("failure_code") <> '')),
	CONSTRAINT "late_payment_recoveries_wdrCKVWtB7tC_fkey" FOREIGN KEY ("payment_attempt_id") REFERENCES "payment_attempts"("id"),
	CONSTRAINT "late_payment_recoveries_ChWHYKy6GqHS_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "late_payment_recoveries_recovered_reservation_unique_idx" ON "late_payment_recoveries" ("recovered_dotypos_reservation_id") WHERE "recovered_dotypos_reservation_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "late_payment_recoveries_reservation_idx" ON "late_payment_recoveries" ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "late_payment_recoveries_state_updated_idx" ON "late_payment_recoveries" ("state","updated_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "reservation_access_grants" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"workspace_reservation_id" text NOT NULL,
	"provider" text DEFAULT 'igloohome' NOT NULL,
	"credential_type" text DEFAULT 'algopin_hourly' NOT NULL,
	"device_id" text NOT NULL,
	"state" text NOT NULL,
	"provider_credential_id" text,
	"access_code" text,
	"reservation_starts_at" timestamp with time zone NOT NULL,
	"access_starts_at" timestamp with time zone NOT NULL,
	"access_ends_at" timestamp with time zone NOT NULL,
	"provisioning_started_at" timestamp with time zone,
	"issued_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reservation_access_grants_provider_check" CHECK ("provider" = 'igloohome' and "credential_type" = 'algopin_hourly'),
	CONSTRAINT "reservation_access_grants_state_check" CHECK ("state" in ('pending', 'provisioning', 'issued', 'expired', 'uncertain', 'failed')),
	CONSTRAINT "reservation_access_grants_interval_check" CHECK ("access_ends_at" > "access_starts_at"),
	CONSTRAINT "reservation_access_grants_issued_check" CHECK ("state" <> 'issued' or (
        "provider_credential_id" is not null
        and "access_code" is not null
        and "issued_at" is not null
      )),
	CONSTRAINT "reservation_access_grants_provisioning_check" CHECK ("state" <> 'provisioning' or "provisioning_started_at" is not null),
	CONSTRAINT "reservation_access_grants_expired_check" CHECK ("state" <> 'expired' or "access_code" is null),
	CONSTRAINT "reservation_access_grants_failure_check" CHECK ("state" <> 'failed' or ("failed_at" is not null and "failure_code" is not null)),
	CONSTRAINT "reservation_access_grants_uncertain_check" CHECK ("state" <> 'uncertain' or "failure_code" is not null),
	CONSTRAINT "reservation_access_grants_uG6VqspNF3w8_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id")
);
--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP COLUMN IF EXISTS "customer_access_code";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "reservation_access_grants_reservation_unique_idx" ON "reservation_access_grants" ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservation_access_grants_state_idx" ON "reservation_access_grants" ("state","updated_at");
