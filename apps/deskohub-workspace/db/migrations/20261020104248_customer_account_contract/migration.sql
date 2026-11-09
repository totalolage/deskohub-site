-- #682 contract. The previous deployment keeps serving while this runs: it
-- creates a login's customer account before the login, records every new link
-- on both customer_account_links and the account, and names an author on every
-- new reservation. Any data this release can't take as it is aborts the
-- migration, so its deployment is never promoted.
--
-- Every login gets its customer account, created when the login was.
INSERT INTO "customer_accounts" ("id", "created_at")
SELECT "id", "created_at" FROM "auth"."user"
ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
-- An account whose login is gone was deleted; it becomes a tombstone. A day's
-- grace spares a sign-up whose account exists but whose login isn't committed
-- yet; the daily auth cleanup cron tombstones the rest once they are a day old.
UPDATE "customer_accounts" SET "deleted_at" = now(), "dotypos_customer_id" = NULL
WHERE "deleted_at" IS NULL
  AND "created_at" < now() - interval '1 day'
  AND NOT EXISTS (
    SELECT 1 FROM "auth"."user" WHERE "auth"."user"."id" = "customer_accounts"."id"
  );
--> statement-breakpoint
-- A tombstone holds no Dotypos customer.
UPDATE "customer_accounts" SET "dotypos_customer_id" = NULL
WHERE "deleted_at" IS NOT NULL AND "dotypos_customer_id" IS NOT NULL;
--> statement-breakpoint
-- Live accounts linked only through customer_account_links take their customer
-- onto the account. An account that already holds another customer, or a
-- customer another account already holds, is a conflict nobody can resolve
-- here.
DO $$
DECLARE
  account_conflicts integer;
  customer_conflicts integer;
BEGIN
  SELECT count(*) INTO account_conflicts
  FROM "customer_account_links" AS link
  JOIN "customer_accounts" AS account ON account."id" = link."customer_account_id"
  WHERE account."deleted_at" IS NULL
    AND account."dotypos_customer_id" <> link."dotypos_customer_id";

  SELECT count(*) INTO customer_conflicts
  FROM "customer_account_links" AS link
  JOIN "customer_accounts" AS account ON account."id" = link."customer_account_id"
  JOIN "customer_accounts" AS holder
    ON holder."dotypos_customer_id" = link."dotypos_customer_id"
   AND holder."id" <> link."customer_account_id"
  WHERE account."deleted_at" IS NULL;

  IF account_conflicts > 0 OR customer_conflicts > 0 THEN
    RAISE EXCEPTION 'customer account links conflict with customer accounts: % accounts hold another customer, % customers belong to another account',
      account_conflicts, customer_conflicts;
  END IF;

  UPDATE "customer_accounts" AS account
  SET "dotypos_customer_id" = link."dotypos_customer_id"
  FROM "customer_account_links" AS link
  WHERE account."id" = link."customer_account_id"
    AND account."deleted_at" IS NULL
    AND account."dotypos_customer_id" IS NULL;
END
$$;
--> statement-breakpoint
ALTER TABLE "auth"."user" ADD CONSTRAINT "user_id_customer_accounts_id_fkey" FOREIGN KEY ("id") REFERENCES "customer_accounts"("id") ON DELETE RESTRICT;--> statement-breakpoint
-- Fails while any reservation has no author: release A's account backfill
-- must run before this release.
ALTER TABLE "workspace_reservations" ALTER COLUMN "author_account_id" SET NOT NULL;
