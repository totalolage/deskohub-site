CREATE SCHEMA "workspace_e2e_coordination";
--> statement-breakpoint
CREATE TABLE "workspace_e2e_coordination"."allocation_pools" (
	"name" text PRIMARY KEY,
	"shard_count" smallint NOT NULL,
	CONSTRAINT "allocation_pools_shard_count_check" CHECK ("shard_count" = 3)
);
--> statement-breakpoint
CREATE TABLE "workspace_e2e_coordination"."allocation_requests" (
	"pool_name" text,
	"repository" text,
	"run_id" bigint,
	"run_attempt" integer,
	"preferred_shard" smallint NOT NULL,
	"queue_position" bigint GENERATED ALWAYS AS IDENTITY (sequence name "workspace_e2e_coordination"."allocation_requests_queue_position_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"allocated_shard" smallint,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acquired_at" timestamp with time zone,
	"last_observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "allocation_requests_pkey" PRIMARY KEY("pool_name","repository","run_id","run_attempt"),
	CONSTRAINT "allocation_requests_run_id_check" CHECK ("run_id" > 0),
	CONSTRAINT "allocation_requests_run_attempt_check" CHECK ("run_attempt" > 0),
	CONSTRAINT "allocation_requests_preferred_shard_check" CHECK ("preferred_shard" between 1 and 3),
	CONSTRAINT "allocation_requests_allocated_shard_check" CHECK ("allocated_shard" is null or "allocated_shard" between 1 and 3),
	CONSTRAINT "allocation_requests_acquired_state_check" CHECK (("allocated_shard" is null) = ("acquired_at" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_requests_pool_queue_unique_idx" ON "workspace_e2e_coordination"."allocation_requests" ("pool_name","queue_position");--> statement-breakpoint
CREATE UNIQUE INDEX "allocation_requests_one_owner_per_shard_idx" ON "workspace_e2e_coordination"."allocation_requests" ("pool_name","allocated_shard") WHERE "allocated_shard" is not null;--> statement-breakpoint
ALTER TABLE "workspace_e2e_coordination"."allocation_requests" ADD CONSTRAINT "allocation_requests_pool_name_allocation_pools_name_fkey" FOREIGN KEY ("pool_name") REFERENCES "workspace_e2e_coordination"."allocation_pools"("name");