CREATE TABLE "standalone_access_code_attempt_events" (
	"id" text PRIMARY KEY DEFAULT uuid_generate_v7(),
	"attempt_id" text NOT NULL,
	"event_kind" text NOT NULL,
	"actor" text NOT NULL,
	"source" text NOT NULL,
	"name" text NOT NULL,
	"device_id" text NOT NULL,
	"starts_at_local" text NOT NULL,
	"ends_at_local" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"variance" integer NOT NULL,
	"provider_credential_id" text,
	"provider_status_code" integer,
	"failure_code" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standalone_access_code_attempt_events_attempt_id_check" CHECK ("attempt_id" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
	CONSTRAINT "standalone_access_code_attempt_events_event_kind_check" CHECK ("event_kind" in ('started', 'created', 'rejected', 'ambiguous')),
	CONSTRAINT "standalone_access_code_attempt_events_source_check" CHECK ("source" in ('admin-ui', 'dhw-cli')),
	CONSTRAINT "standalone_access_code_attempt_events_variance_check" CHECK ("variance" in (2, 3)),
	CONSTRAINT "standalone_access_code_attempt_events_name_check" CHECK (char_length("name") between 1 and 60),
	CONSTRAINT "standalone_access_code_attempt_events_actor_check" CHECK (char_length("actor") between 1 and 80),
	CONSTRAINT "standalone_access_code_attempt_events_interval_check" CHECK ("ends_at" > "starts_at"),
	CONSTRAINT "standalone_access_code_attempt_events_started_check" CHECK ("event_kind" <> 'started' or ("provider_credential_id" is null and "provider_status_code" is null and "failure_code" is null)),
	CONSTRAINT "standalone_access_code_attempt_events_created_check" CHECK ("event_kind" <> 'created' or ("provider_credential_id" is not null and "provider_status_code" is null and "failure_code" is null)),
	CONSTRAINT "standalone_access_code_attempt_events_failure_check" CHECK (("event_kind" <> 'rejected' and "event_kind" <> 'ambiguous') or ("provider_credential_id" is null and "failure_code" is not null)),
	CONSTRAINT "standalone_access_code_attempt_events_failure_code_check" CHECK ("failure_code" is null or "failure_code" in ('standalone_provider_rejected', 'standalone_provider_ambiguous', 'standalone_attempt_stale'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "standalone_access_code_attempt_events_started_unique_idx" ON "standalone_access_code_attempt_events" ("attempt_id") WHERE "event_kind" = 'started';--> statement-breakpoint
CREATE UNIQUE INDEX "standalone_access_code_attempt_events_terminal_unique_idx" ON "standalone_access_code_attempt_events" ("attempt_id") WHERE "event_kind" in ('created', 'rejected', 'ambiguous');--> statement-breakpoint
CREATE INDEX "standalone_access_code_attempt_events_window_idx" ON "standalone_access_code_attempt_events" ("device_id","starts_at","ends_at");