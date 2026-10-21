ALTER TABLE "email_campaign_automation_preview_rows" ADD COLUMN IF NOT EXISTS "reservation_statuses_approximate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- #764's account backfill gave every login without a customer account one
-- dated when the backfill ran, so a years-old login looked like an account
-- created that day. An account is created when its login is, as the #682
-- contract migration dates the accounts it inserts, so every live account
-- takes its login's creation time where the login is earlier. A second run
-- finds nothing earlier and changes nothing.
--
-- A linked account's account-created event carries the account's creation
-- time, so it moves with the account. A linked account without one gets it
-- now, already processed: it starts nothing, and the capture reconciler never
-- records one dated from the repaired time. The upsert also catches an event
-- the reconciler or a first link commits while this runs, at the old time.
WITH "repaired" AS (
  UPDATE "customer_accounts" SET "created_at" = "auth"."user"."created_at"
  FROM "auth"."user"
  WHERE "auth"."user"."id" = "customer_accounts"."id"
    AND "auth"."user"."created_at" < "customer_accounts"."created_at"
    AND "customer_accounts"."deleted_at" IS NULL
  RETURNING "customer_accounts"."id", "customer_accounts"."created_at",
    "customer_accounts"."dotypos_customer_id"
)
INSERT INTO "customer_events"
  ("kind", "occurred_at", "dotypos_customer_id", "customer_account_id", "automation_processed_at")
SELECT 'account-created', "created_at", "dotypos_customer_id", "id", now()
FROM "repaired"
WHERE "dotypos_customer_id" IS NOT NULL
ON CONFLICT ("kind", "customer_account_id") WHERE "customer_account_id" IS NOT NULL
DO UPDATE SET "occurred_at" = EXCLUDED."occurred_at";
