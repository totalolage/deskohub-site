CREATE TABLE "paid_fulfillment_jobs" (
  "id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
  "payment_paid_event_id" text NOT NULL UNIQUE,
  "workspace_reservation_id" text NOT NULL,
  "state" text DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "lease_owner_id" text,
  "claimed_at" timestamp with time zone,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "paid_fulfillment_jobs_state_check" CHECK ("state" in ('pending', 'processing', 'completed', 'manual')),
  CONSTRAINT "paid_fulfillment_jobs_attempt_count_check" CHECK ("attempt_count" between 0 and 8),
  CONSTRAINT "paid_fulfillment_jobs_lease_check" CHECK (("state" = 'processing' and "lease_owner_id" is not null and btrim("lease_owner_id") <> '' and "claimed_at" is not null) or ("state" <> 'processing' and "lease_owner_id" is null and "claimed_at" is null)),
  CONSTRAINT "paid_fulfillment_jobs_completed_check" CHECK (("state" = 'completed' and "completed_at" is not null) or ("state" <> 'completed' and "completed_at" is null)),
  CONSTRAINT "paid_fulfillment_jobs_manual_check" CHECK ("state" <> 'manual' or "failure_code" is not null)
);
--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_due_idx" ON "paid_fulfillment_jobs" ("state","next_attempt_at");--> statement-breakpoint
CREATE INDEX "paid_fulfillment_jobs_reservation_idx" ON "paid_fulfillment_jobs" ("workspace_reservation_id");--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_Ecnat6TaiDsL_fkey" FOREIGN KEY ("payment_paid_event_id") REFERENCES "payment_paid_events"("id");--> statement-breakpoint
ALTER TABLE "paid_fulfillment_jobs" ADD CONSTRAINT "paid_fulfillment_jobs_etoWMNoUJncz_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id");
