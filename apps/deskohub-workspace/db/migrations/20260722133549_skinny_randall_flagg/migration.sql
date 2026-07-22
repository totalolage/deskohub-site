ALTER TABLE "workspace_reservations" RENAME COLUMN "reservation_intent_key" TO "checkout_attempt_key";--> statement-breakpoint
ALTER INDEX "workspace_reservations_intent_key_unique_idx" RENAME TO "workspace_reservations_attempt_key_unique_idx";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD COLUMN "checkout_session_key" text DEFAULT uuid_generate_v7() NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_reservations_active_session_unique_idx" ON "workspace_reservations" ("checkout_session_key") WHERE "reservation_state" <> 'cancelled';--> statement-breakpoint
CREATE INDEX "workspace_reservations_checkout_session_idx" ON "workspace_reservations" ("checkout_session_key","created_at");