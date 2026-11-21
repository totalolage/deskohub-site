CREATE TABLE "unlimited_pass_day_moves" (
	"generation" uuid PRIMARY KEY,
	"reservation_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"source_reservation_id" text NOT NULL,
	"source_table_id" text NOT NULL,
	"source_generation" uuid,
	"target_reservation_id" text,
	"target_table_id" text NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"attached_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"ambiguous_at" timestamp with time zone,
	"ambiguous_reservation_ids" text[],
	CONSTRAINT "unlimited_pass_day_moves_destination_check" CHECK ("target_table_id" <> "source_table_id"
        and "target_reservation_id" is distinct from "source_reservation_id"
        and ("attached_at" is null or "target_reservation_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "pass_purchases" ADD COLUMN "renews_pass_id" text;--> statement-breakpoint
CREATE INDEX "pass_purchases_renews_pass_idx" ON "pass_purchases" ("renews_pass_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unlimited_pass_day_moves_pending_reservation_idx" ON "unlimited_pass_day_moves" ("reservation_id") WHERE "settled_at" is null;--> statement-breakpoint
CREATE INDEX "unlimited_pass_day_moves_pending_checked_idx" ON "unlimited_pass_day_moves" ("checked_at") WHERE "settled_at" is null;--> statement-breakpoint
CREATE INDEX "unlimited_pass_day_moves_source_idx" ON "unlimited_pass_day_moves" ("source_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unlimited_pass_day_moves_target_idx" ON "unlimited_pass_day_moves" ("target_reservation_id") WHERE "target_reservation_id" is not null;--> statement-breakpoint
ALTER TABLE "pass_purchases" ADD CONSTRAINT "pass_purchases_renews_pass_id_fk" FOREIGN KEY ("renews_pass_id") REFERENCES "pass_purchases"("id");--> statement-breakpoint
ALTER TABLE "unlimited_pass_day_moves" ADD CONSTRAINT "unlimited_pass_day_moves_QjT6Urq60EIo_fkey" FOREIGN KEY ("reservation_id") REFERENCES "workspace_reservations"("id");--> statement-breakpoint
ALTER TABLE "pass_purchases" ADD CONSTRAINT "pass_purchases_renewal_check" CHECK ("renews_pass_id" is null or ("product" = 'unlimited'
        and "renews_pass_id" <> "id"));