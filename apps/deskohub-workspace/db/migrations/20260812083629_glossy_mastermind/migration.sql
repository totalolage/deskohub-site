CREATE TABLE "mobile_session_handoff_codes" (
	"code_hash" text PRIMARY KEY,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "mobile_session_handoff_codes_hash_check" CHECK ("code_hash" ~ '^[A-Za-z0-9_-]{43}$'),
	CONSTRAINT "mobile_session_handoff_codes_expiry_check" CHECK ("expires_at" > "created_at")
);
--> statement-breakpoint
CREATE INDEX "mobile_session_handoff_codes_expires_at_idx" ON "mobile_session_handoff_codes" ("expires_at");