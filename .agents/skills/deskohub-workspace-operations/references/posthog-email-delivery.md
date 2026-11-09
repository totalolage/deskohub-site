# PostHog campaign email delivery

Workspace sends campaign (marketing) email through PostHog's transactional
email API first and Resend second, per message; transactional email stays on
Resend. Delivery rules are in the `deskohub-workspace-domain` skill's
`references/email-campaigns.md`, the provider packages and chains in the
`deskohub-email` skill, and what PostHog receives in the
`deskohub-workspace-account` skill's `references/posthog-identity-privacy.md`.

## Configuration

- `POSTHOG_EMAIL_SECRET_KEY`: a project secret API key (`phs_…`) of the
  production project with Transactional email Write and Read
  (`transactional_email:write` sends; `:read` reads status). It's a different key from `POSTHOG_API_KEY` and
  `POSTHOG_PERSON_PRIVACY_API_KEY`; don't widen either of those.
- `POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET`: the signing secret of the PostHog
  webhook destination below.
- Both are required in Production and optional in Preview and
  development. Without the key the status poller reports `not-configured`
  and reads nothing.
- The host is `POSTHOG_API_HOST`. The provider calls the app host
  (`https://eu.posthog.com`); an ingestion host (`https://eu.i.posthog.com`)
  maps to the app host, so the secret key
  never reaches an ingestion endpoint. It addresses `@current`, so no
  project ID is needed, and PostHog picks the sender channel from the
  verified `from` address (`EMAIL_CAMPAIGN_FROM`).

## Delivery status

- PostHog answers a send with `202` and a message ID: queued, not delivered.
  The campaign recipient stores that ID as `provider_message_id`, and the
  email observer inserts a `posthog_email_deliveries` row (primary key
  `message_id`) for status polling.
- PostHog's per-message status API (`queued`, `sent`, `failed`, `delivered`,
  `bounced`, `complained`) is the source of truth, and it keeps a message
  for 30 days. Engagement events only trigger a read.
- `POST /api/webhooks/posthog` (`app/api/webhooks/posthog/route.ts`; `GET`
  is a health check) verifies the Standard Webhooks headers (`webhook-id`,
  `webhook-timestamp`, `webhook-signature`; HMAC-SHA256, 5-minute timestamp
  tolerance) with `POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET` (the `whsec_` form
  is accepted). A bad or missing signature gets 401; an unset secret gets a
  retryable refusal, like the Resend route. A valid call is only a signal:
  the route ignores the payload, polls due rows (bounded), and answers 200.
- `GET /api/cron/workspace/posthog-email-deliveries` runs every 15 minutes
  (`*/15 * * * *` in `vercel.json`) with the shared cron auth (`Bearer
  CRON_SECRET`), as the safety net for lost or late webhook calls.
- Polling backs off 1, 2, 5, and 15 minutes, then every 15 minutes, at most
  100 rows a run and about 500 reads a minute (PostHog allows 600).
  `queued` and `sent` keep polling. `delivered`, `failed`, `bounced`, and
  `complained` go to the same delivery-report handlers as Resend reports
  (reservation and campaign status) and settle the row. A message that
  answers 404 for 24 hours expires as `not-found`; 30 days after sending,
  PostHog's status retention, it expires as `status-retention-ended`
  without a read. Settled rows are deleted 30 days after settling.
- Production, Preview, and development share the one PostHog project.
  Reports carry the `deploymentEnvironment` tag, and the handlers ignore
  another deployment's reports.

## One-time setup in PostHog

Done by a person with access to the production PostHog project (EU Cloud)
and the sending domain's DNS.

1. Sender: Workflows → Channels → + New channel → Email, with the from name
   and address of `EMAIL_CAMPAIGN_FROM`. Each sender address is a channel;
   another address on a verified domain reuses its verification.
2. DNS: publish the records the channel shows for the sending domain.
   PostHog's EU template lists an `_amazonses` TXT record, three DKIM CNAMEs,
   `include:amazonses.com` in the apex SPF, a MAIL FROM subdomain with MX and
   SPF, and `_dmarc`. A name holds at most one SPF record: when the apex
   already has one, add the include to it rather than publishing a second.
   Wait for SPF and DKIM to verify in the channel.
3. Secret key: Project settings → Project secret API keys → Create project
   secret API key, with Transactional email Write and Read. Store it as
   `POSTHOG_EMAIL_SECRET_KEY` in Vercel (sensitive).
4. Engagement events: Settings → Workflows → Engagement events on. The
   `$workflows_email_*` events carry `$email_to` and `$email_subject`; the
   owner accepted that on 2026-11-09.
5. Destination: Data pipelines → + New → Destination → Webhook, URL
   `https://workspace.deskohub.cz/api/webhooks/posthog`, method POST,
   filtered to the `$workflows_email_*` events; the default body is fine,
   because the route ignores it. Set a signing secret (Standard Webhooks)
   and store it as `POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET`.
6. Redeploy production so the new variables load.

## Sending limits

PostHog starts a new sending project at tier 0 (50 an hour, 100 a day) and
raises it at most one tier per daily review: time at the tier, at least half
the daily cap sent on two days, bounces under 2%, complaints under 0.1%.
Sends above the allowance are accepted (`202`) and stay queued at PostHog,
so they don't fall back to Resend; messages beyond the allowance stay
queued at PostHog, and a large campaign's statuses stay `queued` until it
sends them. The API request cap (600 a minute, 20,000
an hour) and the billing quota answer `429` and do fall back.

## Diagnosing

- Fallback rate: the anonymous `email provider fallback` server event
  (properties in the `deskohub-workspace-account` skill's
  `references/posthog-identity-privacy.md`). A run of `provider` errors from `posthog` means PostHog is
  refusing sends (key, paused or suspended sending, quota) and Resend is
  carrying campaign mail.
- Webhook calls rejected with 401: the destination's signing secret and
  `POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET` differ. With the destination
  failing or disabled, the 15-minute cron still polls due rows, so statuses
  settle on its schedule and backoff.
- Poll result `unauthorized` (logged at error level): the secret key lost
  `transactional_email:read` or was revoked. `rate-limited`: PostHog
  answered 429; the rows stay due.
- Rows expiring `not-found`: the message ID is unknown to the key's project,
  for example a key from another project. A `404` shortly after sending is
  normal.
