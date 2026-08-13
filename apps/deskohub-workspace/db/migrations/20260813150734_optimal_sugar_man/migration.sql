ALTER TABLE "workspace_reservations" ADD COLUMN IF NOT EXISTS "reservation_purpose" text;--> statement-breakpoint
ALTER TABLE "workspace_reservations" DROP CONSTRAINT IF EXISTS "workspace_reservations_purpose_check";--> statement-breakpoint
ALTER TABLE "workspace_reservations" ADD CONSTRAINT "workspace_reservations_purpose_check" CHECK ("reservation_purpose" is null or "reservation_purpose" in ('personal', 'business'));
