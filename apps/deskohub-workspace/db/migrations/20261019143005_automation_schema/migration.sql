CREATE TABLE "customer_event_sweeps" (
	"source" text PRIMARY KEY,
	"swept_until" timestamp with time zone NOT NULL,
	"window_starts_at" timestamp with time zone,
	"window_ends_at" timestamp with time zone,
	"next_page" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customer_event_sweeps_source_check" CHECK ("source" in ('reservation-activity', 'reservation-activity-reconcile')),
	CONSTRAINT "customer_event_sweeps_window_check" CHECK (("window_starts_at" is null) = ("window_ends_at" is null) and ("window_starts_at" is null) = ("next_page" is null) and ("window_starts_at" is null or "window_starts_at" < "window_ends_at") and ("next_page" is null or "next_page" >= 1))
);
--> statement-breakpoint
CREATE TABLE "customer_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"workspace_reservation_id" text,
	"customer_account_id" text,
	"automation_unit_id" text,
	"automation_processed_at" timestamp with time zone,
	CONSTRAINT "customer_events_kind_check" CHECK ("kind" in ('reservation-booked', 'reservation-cancelled', 'reservation-started', 'reservation-finished', 'account-created')),
	CONSTRAINT "customer_events_reservation_check" CHECK (("kind" like 'reservation-%') = ("workspace_reservation_id" is not null)),
	CONSTRAINT "customer_events_account_check" CHECK (("kind" = 'account-created') = ("customer_account_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_engine" (
	"id" smallint PRIMARY KEY,
	"last_planned_at" timestamp with time zone,
	"last_plan_summary" jsonb,
	CONSTRAINT "email_campaign_automation_engine_singleton_check" CHECK ("id" = 1)
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_preview_rows" (
	"preview_id" text,
	"dotypos_customer_id" text,
	"trigger_at" timestamp with time zone,
	"customer_event_id" text,
	"outcome" text NOT NULL,
	"step_id" text,
	"send_at" timestamp with time zone,
	"projected" boolean NOT NULL,
	CONSTRAINT "email_campaign_automation_preview_rows_pkey" PRIMARY KEY("preview_id","dotypos_customer_id","trigger_at"),
	CONSTRAINT "email_campaign_automation_preview_rows_outcome_check" CHECK ("outcome" in ('would-send', 'condition-failed', 'not-in-audience', 'already-active', 'withdrawn', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_previews" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"campaign_id" text NOT NULL,
	"draft_hash" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"units_total" integer NOT NULL,
	"units_done" integer DEFAULT 0 NOT NULL,
	"counts" jsonb DEFAULT '{}' NOT NULL,
	"events_total" integer,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "email_campaign_automation_previews_kind_check" CHECK ("kind" in ('schedule', 'replay')),
	CONSTRAINT "email_campaign_automation_previews_status_check" CHECK ("status" in ('running', 'completed', 'superseded', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_run_events" (
	"run_id" text,
	"sequence" integer,
	"kind" text NOT NULL,
	"step_id" text,
	"at" timestamp with time zone NOT NULL,
	"detail" jsonb DEFAULT '{}' NOT NULL,
	CONSTRAINT "email_campaign_automation_run_events_pkey" PRIMARY KEY("run_id","sequence"),
	CONSTRAINT "email_campaign_automation_run_events_kind_check" CHECK ("kind" in ('started', 'condition-passed', 'condition-failed', 'waiting', 'woke', 'deferred', 'send-queued', 'sent', 'unconfirmed', 'skipped', 'failed', 'withdrawn', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_runs" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"campaign_id" text NOT NULL,
	"version_id" text NOT NULL,
	"dotypos_customer_id" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"trigger_at" timestamp with time zone NOT NULL,
	"trigger_event_id" text,
	"trigger_reservation_id" text,
	"status" text NOT NULL,
	"step_id" text NOT NULL,
	"phase" text,
	"step_entered_at" timestamp with time zone NOT NULL,
	"due_at" timestamp with time zone,
	"work_unit_id" text,
	"send_id" text,
	"outcome" text,
	"outcome_reason" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_automation_runs_trigger_kind_check" CHECK ("trigger_kind" in ('schedule', 'reservation-booked', 'reservation-cancelled', 'reservation-started', 'reservation-finished', 'account-created')),
	CONSTRAINT "email_campaign_automation_runs_status_check" CHECK (("status" = 'active' and "phase" is not null and "phase" in ('ready', 'waiting') and "due_at" is not null and "outcome" is null and "ended_at" is null) or ("status" = 'sending' and "phase" is null and "due_at" is null and "send_id" is not null and "outcome" is null and "ended_at" is null) or ("status" = 'ended' and "phase" is null and "due_at" is null and "outcome" is not null and "ended_at" is not null)),
	CONSTRAINT "email_campaign_automation_runs_outcome_check" CHECK ("outcome" is null or "outcome" in ('sent', 'unconfirmed', 'condition-failed', 'skipped', 'failed', 'withdrawn', 'archived')),
	CONSTRAINT "email_campaign_automation_runs_reason_check" CHECK (("outcome" is not null and "outcome" in ('skipped', 'failed')) = ("outcome_reason" is not null)),
	CONSTRAINT "email_campaign_automation_runs_trigger_check" CHECK (("trigger_kind" like 'reservation-%') = ("trigger_reservation_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_schedule_fires" (
	"campaign_id" text,
	"fire_at" timestamp with time zone,
	"version_id" text NOT NULL,
	"status" text NOT NULL,
	"chunks_total" integer NOT NULL,
	"chunks_done" integer DEFAULT 0 NOT NULL,
	"entered_count" integer DEFAULT 0 NOT NULL,
	"settled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_automation_schedule_fires_pkey" PRIMARY KEY("campaign_id","fire_at"),
	CONSTRAINT "email_campaign_automation_schedule_fires_status_check" CHECK ("status" in ('entering', 'entered', 'dropped', 'failed')),
	CONSTRAINT "email_campaign_automation_schedule_fires_settled_check" CHECK (("status" = 'entering') = ("settled_at" is null)),
	CONSTRAINT "email_campaign_automation_schedule_fires_chunks_check" CHECK ("chunks_done" between 0 and "chunks_total")
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_trigger_receipts" (
	"campaign_id" text,
	"dedup_key" text,
	"version_id" text NOT NULL,
	"customer_event_id" text,
	"dotypos_customer_id" text NOT NULL,
	"disposition" text NOT NULL,
	"run_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_automation_trigger_receipts_pkey" PRIMARY KEY("campaign_id","dedup_key"),
	CONSTRAINT "email_campaign_automation_trigger_receipts_disposition_check" CHECK ("disposition" in ('started', 'already-active', 'not-in-audience', 'withdrawn', 'failed')),
	CONSTRAINT "email_campaign_automation_trigger_receipts_run_check" CHECK (("disposition" = 'started') = ("run_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_version_provenance" (
	"version_id" text PRIMARY KEY,
	"audience_id" text,
	"activated_by_account_id" text
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_versions" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"campaign_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"flow" jsonb NOT NULL,
	"trigger_kind" text GENERATED ALWAYS AS (flow->'trigger'->>'_tag') STORED NOT NULL,
	"purpose" text NOT NULL,
	"template_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"audience_filter" jsonb NOT NULL,
	"draft_hash" text NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_automation_versions_number_check" CHECK ("version_number" >= 1),
	CONSTRAINT "email_campaign_automation_versions_purpose_check" CHECK ("purpose" in ('marketing', 'operational'))
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automation_work_units" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"kind" text NOT NULL,
	"priority" smallint NOT NULL,
	"campaign_id" text,
	"key" text NOT NULL,
	"subject" jsonb NOT NULL,
	"request_cost" smallint NOT NULL,
	"status" text NOT NULL,
	"claim_id" text,
	"claim_expires_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"send_id" text,
	"enqueue_generation" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"deadline_misses" integer DEFAULT 0 NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_attempt_at" timestamp with time zone,
	"enqueued_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	CONSTRAINT "email_campaign_automation_work_units_status_check" CHECK ("status" in ('planned', 'enqueued', 'claimed', 'done', 'dropped', 'failed')),
	CONSTRAINT "email_campaign_automation_work_units_claim_check" CHECK (("status" = 'claimed') = ("claim_id" is not null and "claim_expires_at" is not null)),
	CONSTRAINT "email_campaign_automation_work_units_settled_check" CHECK (("status" in ('done', 'dropped', 'failed')) = ("settled_at" is not null)),
	CONSTRAINT "email_campaign_automation_work_units_cost_check" CHECK ("request_cost" >= 0)
);
--> statement-breakpoint
CREATE TABLE "email_campaign_automations" (
	"campaign_id" text PRIMARY KEY,
	"flow" jsonb,
	"active_version_id" text,
	"accepting_since" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"resumed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"next_fire_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_campaign_automations_accepting_check" CHECK (("accepting_since" is null) or ("active_version_id" is not null))
);
--> statement-breakpoint
DROP INDEX "email_campaign_sends_campaign_unique_idx";--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD COLUMN "automation_version_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "customer_events_workspace_write_unique_idx" ON "customer_events" ("kind","workspace_reservation_id") WHERE "kind" in ('reservation-booked', 'reservation-cancelled');--> statement-breakpoint
CREATE UNIQUE INDEX "customer_events_visit_unique_idx" ON "customer_events" ("kind","workspace_reservation_id","occurred_at") WHERE "kind" in ('reservation-started', 'reservation-finished');--> statement-breakpoint
CREATE UNIQUE INDEX "customer_events_account_unique_idx" ON "customer_events" ("kind","customer_account_id") WHERE "customer_account_id" is not null;--> statement-breakpoint
CREATE INDEX "customer_events_unprocessed_idx" ON "customer_events" ("recorded_at") WHERE "automation_processed_at" is null and "automation_unit_id" is null;--> statement-breakpoint
CREATE INDEX "customer_events_kind_occurred_idx" ON "customer_events" ("kind","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_previews_one_running_idx" ON "email_campaign_automation_previews" ("campaign_id") WHERE "status" = 'running';--> statement-breakpoint
CREATE INDEX "email_campaign_automation_previews_created_idx" ON "email_campaign_automation_previews" ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_runs_one_open_run_idx" ON "email_campaign_automation_runs" ("campaign_id","dotypos_customer_id") WHERE "status" <> 'ended';--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_due_idx" ON "email_campaign_automation_runs" ("due_at") WHERE "status" = 'active';--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_unplanned_ready_idx" ON "email_campaign_automation_runs" ("campaign_id","step_id") WHERE "status" = 'active' and "phase" = 'ready' and "work_unit_id" is null;--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_campaign_state_idx" ON "email_campaign_automation_runs" ("campaign_id","status","step_id");--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_campaign_started_idx" ON "email_campaign_automation_runs" ("campaign_id","started_at");--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_trigger_reservation_idx" ON "email_campaign_automation_runs" ("trigger_reservation_id") WHERE "status" <> 'ended';--> statement-breakpoint
CREATE INDEX "email_campaign_automation_runs_send_idx" ON "email_campaign_automation_runs" ("send_id") WHERE "send_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_schedule_fires_one_open_idx" ON "email_campaign_automation_schedule_fires" ("campaign_id") WHERE "status" = 'entering';--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_versions_number_unique_idx" ON "email_campaign_automation_versions" ("campaign_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_versions_campaign_unique_idx" ON "email_campaign_automation_versions" ("id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_versions_activated_unique_idx" ON "email_campaign_automation_versions" ("campaign_id","activated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_automation_work_units_key_unique_idx" ON "email_campaign_automation_work_units" ("key");--> statement-breakpoint
CREATE INDEX "email_campaign_automation_work_units_planned_idx" ON "email_campaign_automation_work_units" ("priority","created_at") WHERE "status" = 'planned';--> statement-breakpoint
CREATE INDEX "email_campaign_automation_work_units_in_flight_idx" ON "email_campaign_automation_work_units" ("kind","campaign_id") WHERE "status" in ('enqueued', 'claimed');--> statement-breakpoint
CREATE INDEX "email_campaign_automation_work_units_settled_idx" ON "email_campaign_automation_work_units" ("settled_at") WHERE "settled_at" is not null;--> statement-breakpoint
CREATE INDEX "email_campaign_automations_next_fire_idx" ON "email_campaign_automations" ("next_fire_at") WHERE "next_fire_at" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "email_campaign_sends_once_campaign_unique_idx" ON "email_campaign_sends" ("campaign_id") WHERE "automation_version_id" is null;--> statement-breakpoint
CREATE INDEX "email_campaign_sends_campaign_idx" ON "email_campaign_sends" ("campaign_id");--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_ZVYweWsHwecd_fkey" FOREIGN KEY ("workspace_reservation_id") REFERENCES "workspace_reservations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "customer_events" ADD CONSTRAINT "customer_events_customer_account_id_customer_accounts_id_fkey" FOREIGN KEY ("customer_account_id") REFERENCES "customer_accounts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_preview_rows" ADD CONSTRAINT "email_campaign_automation_preview_rows_A1HNaSaD1f7p_fkey" FOREIGN KEY ("preview_id") REFERENCES "email_campaign_automation_previews"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_previews" ADD CONSTRAINT "email_campaign_automation_previews_QygPUQjko5ul_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_run_events" ADD CONSTRAINT "email_campaign_automation_run_events_11Xh4crxBZCO_fkey" FOREIGN KEY ("run_id") REFERENCES "email_campaign_automation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_runs" ADD CONSTRAINT "email_campaign_automation_runs_lLI0i7nexgve_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_runs" ADD CONSTRAINT "email_campaign_automation_runs_ubLTT859e4qB_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "customer_events"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_runs" ADD CONSTRAINT "email_campaign_automation_runs_4E1Zgwi4LmLg_fkey" FOREIGN KEY ("trigger_reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_runs" ADD CONSTRAINT "email_campaign_automation_runs_version_fk" FOREIGN KEY ("version_id","campaign_id") REFERENCES "email_campaign_automation_versions"("id","campaign_id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_runs" ADD CONSTRAINT "email_campaign_automation_runs_recipient_fk" FOREIGN KEY ("send_id","dotypos_customer_id") REFERENCES "email_campaign_recipients"("send_id","dotypos_customer_id") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_schedule_fires" ADD CONSTRAINT "email_campaign_automation_schedule_fires_C0qfrSk2BCrn_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_schedule_fires" ADD CONSTRAINT "email_campaign_automation_schedule_fires_version_fk" FOREIGN KEY ("version_id","campaign_id") REFERENCES "email_campaign_automation_versions"("id","campaign_id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_trigger_receipts" ADD CONSTRAINT "email_campaign_automation_trigger_receipts_rbeiovm1i8Js_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_trigger_receipts" ADD CONSTRAINT "email_campaign_automation_trigger_receipts_iDlmNBwXUNhD_fkey" FOREIGN KEY ("customer_event_id") REFERENCES "customer_events"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_trigger_receipts" ADD CONSTRAINT "email_campaign_automation_trigger_receipts_FGRJKPK5wc75_fkey" FOREIGN KEY ("run_id") REFERENCES "email_campaign_automation_runs"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_trigger_receipts" ADD CONSTRAINT "email_campaign_automation_trigger_receipts_version_fk" FOREIGN KEY ("version_id","campaign_id") REFERENCES "email_campaign_automation_versions"("id","campaign_id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_version_provenance" ADD CONSTRAINT "email_campaign_automation_version_provenance_ywUi66KsgEzX_fkey" FOREIGN KEY ("version_id") REFERENCES "email_campaign_automation_versions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_version_provenance" ADD CONSTRAINT "email_campaign_automation_version_provenance_QXu91or3VZ4F_fkey" FOREIGN KEY ("audience_id") REFERENCES "email_campaign_audiences"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_version_provenance" ADD CONSTRAINT "email_campaign_automation_version_provenance_bPug6kIkqT0q_fkey" FOREIGN KEY ("activated_by_account_id") REFERENCES "auth"."user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "email_campaign_automation_versions" ADD CONSTRAINT "email_campaign_automation_versions_08WdqYWRCMM1_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_work_units" ADD CONSTRAINT "email_campaign_automation_work_units_6JV46JiMTAQ1_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automation_work_units" ADD CONSTRAINT "email_campaign_automation_work_units_cMStg3GNosH2_fkey" FOREIGN KEY ("send_id") REFERENCES "email_campaign_sends"("id");--> statement-breakpoint
ALTER TABLE "email_campaign_automations" ADD CONSTRAINT "email_campaign_automations_campaign_id_email_campaigns_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "email_campaign_automations" ADD CONSTRAINT "email_campaign_automations_active_version_fk" FOREIGN KEY ("active_version_id","campaign_id") REFERENCES "email_campaign_automation_versions"("id","campaign_id");--> statement-breakpoint
ALTER TABLE "email_campaign_sends" ADD CONSTRAINT "email_campaign_sends_automation_version_fk" FOREIGN KEY ("automation_version_id","campaign_id") REFERENCES "email_campaign_automation_versions"("id","campaign_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION reject_automation_version_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'automation versions are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS email_campaign_automation_versions_immutable ON "email_campaign_automation_versions";
--> statement-breakpoint
CREATE TRIGGER email_campaign_automation_versions_immutable
BEFORE UPDATE OR DELETE ON "email_campaign_automation_versions"
FOR EACH ROW
EXECUTE FUNCTION reject_automation_version_change();
--> statement-breakpoint
INSERT INTO "email_campaign_automation_engine" ("id") VALUES (1) ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "customer_event_sweeps" ("source", "swept_until") VALUES
	('reservation-activity', now() - interval '35 days'),
	('reservation-activity-reconcile', now())
ON CONFLICT DO NOTHING;
