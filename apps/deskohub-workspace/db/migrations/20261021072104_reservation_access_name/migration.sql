-- #780. The previous deployment keeps serving while this runs: it neither
-- reads nor writes the name, so the column stays nullable. A null name marks a
-- grant that deployment created, under the name built from its reservation.
ALTER TABLE "reservation_access_grants" ADD COLUMN "access_name" text;
--> statement-breakpoint
-- Existing grants were issued under the name built from their reservation;
-- operators find their credentials in the Igloohome app by that name. A
-- pending grant can still have one: moving an issued grant resets it to
-- pending while the replaced credential stays live.
UPDATE "reservation_access_grants"
SET "access_name" = left('Deskohub ' || "workspace_reservation_id", 60);
