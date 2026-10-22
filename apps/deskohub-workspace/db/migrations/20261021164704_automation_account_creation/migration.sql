ALTER TABLE "email_campaign_automation_preview_rows" ADD COLUMN IF NOT EXISTS "reservation_statuses_approximate" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "customer_accounts" ADD COLUMN IF NOT EXISTS "legacy" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- #764's backfill gave each existing customer a silent login, dated when the
-- backfill ran. Those customers aren't new accounts (D37), so their accounts
-- become legacy, linked or not: a link the backfill lost to a conflict is
-- claimed at a later sign-in, and that claim records no account creation for
-- a legacy account. The backfill kept no record of the logins it made, but
-- its operation could only run between #764's merge and the first production
-- deployment without it, #772's, ready at 2026-10-20T18:49:15Z (#765's own
-- failed). It created logins within admin requests, so none is later than
-- one request after that; 19:10 leaves a margin over Vercel's longest
-- function duration. Every other login since #764 merged is made by its
-- owner's verified sign-in, which opens its first session moments after it
-- commits the login.
-- The backfill's logins were unverified and had no session, and one verified
-- later opens its first session at that later sign-in. So a login from that
-- window that is unverified, or has no session from its first ten seconds, is
-- one. A sign-up from the window whose first session has since ended counts
-- too: it misses only a welcome, while a customer counted as new would be
-- welcomed as one. A linked login from the window is also one if it authors
-- a reservation older than itself, which only the backfill assigned it, or
-- has no account-created event, which a sign-in claim records in the
-- transaction that links the account. A login outside the window isn't the
-- backfill's: an older one predates #764, however late its account was
-- backfilled, and a later one may be a sign-up still between its login and
-- its first session or claim.
-- This runs before the repair below, which records events without a claim.
-- A second run finds every such account already legacy.
UPDATE "customer_accounts" SET "legacy" = true
FROM "auth"."user"
WHERE "auth"."user"."id" = "customer_accounts"."id"
  AND "auth"."user"."created_at" BETWEEN '2026-10-20T17:32:49Z' AND '2026-10-20T19:10:00Z'
  AND "customer_accounts"."deleted_at" IS NULL
  AND NOT "customer_accounts"."legacy"
  AND (
    NOT "auth"."user"."email_verified"
    OR NOT EXISTS (
      SELECT 1 FROM "auth"."session"
      WHERE "auth"."session"."user_id" = "auth"."user"."id"
        AND "auth"."session"."created_at" < "auth"."user"."created_at" + interval '10 seconds'
    )
    OR (
      "customer_accounts"."dotypos_customer_id" IS NOT NULL
      AND (
        EXISTS (
          SELECT 1 FROM "workspace_reservations"
          WHERE "workspace_reservations"."author_account_id" = "customer_accounts"."id"
            AND "workspace_reservations"."created_at" < "auth"."user"."created_at"
        )
        OR NOT EXISTS (
          SELECT 1 FROM "customer_events"
          WHERE "customer_events"."kind" = 'account-created'
            AND "customer_events"."customer_account_id" = "customer_accounts"."id"
        )
      )
    )
  );
--> statement-breakpoint
-- #764's account backfill gave every login without a customer account one
-- dated when the backfill ran, so a years-old login looked like an account
-- created that day. An account is created when its login is, as the #682
-- contract migration dates the accounts it inserts, so every live account
-- takes its login's creation time where the login is earlier. A legacy
-- account has no real creation time to take. A second run finds nothing
-- earlier and changes nothing.
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
    AND NOT "customer_accounts"."legacy"
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
