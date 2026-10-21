-- #780. The previous deployment keeps serving while this runs: it neither
-- reads nor writes the name, so the column stays nullable. A grant gets its
-- name when issuance claims it.
ALTER TABLE "reservation_access_grants" ADD COLUMN "access_name" text;
--> statement-breakpoint
-- Existing grants were issued under the name built from their reservation;
-- operators find their credentials in the Igloohome app by that name.
UPDATE "reservation_access_grants"
SET "access_name" = left('Deskohub ' || "workspace_reservation_id", 60);
