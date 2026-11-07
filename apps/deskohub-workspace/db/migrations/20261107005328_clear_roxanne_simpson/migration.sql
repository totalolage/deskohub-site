CREATE TABLE "mobile_update_publications" (
	"id" text PRIMARY KEY,
	"platform" text NOT NULL,
	"runtime_version" text NOT NULL,
	"publication" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "mobile_update_publications_latest_idx" ON "mobile_update_publications" ("platform","runtime_version","published_at");