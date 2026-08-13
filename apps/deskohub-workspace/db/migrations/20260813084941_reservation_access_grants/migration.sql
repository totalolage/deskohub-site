CREATE TABLE "reservation_access_grants" (
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
	CONSTRAINT "reservation_access_grants_uncertain_check" CHECK ("state" <> 'uncertain' or "failure_code" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_access_grants_reservation_unique_idx" ON "reservation_access_grants" ("workspace_reservation_id");--> statement-breakpoint
CREATE INDEX "reservation_access_grants_state_idx" ON "reservation_access_grants" ("state","updated_at");--> statement-breakpoint
ALTER TABLE "reservation_access_grants" ADD CONSTRAINT "reservation_access_grants_uG6VqspNF3w8_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");