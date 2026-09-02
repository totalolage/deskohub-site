# Customer-account data retention contract

Research snapshot: 2026-09-02. This note uses provider documentation and the
source of the pinned `better-auth` 1.7.2 release. It distinguishes documented
behavior from product policy so the implementation and privacy copy do not
promise behavior a provider does not guarantee.

## Better Auth 1.7.2 data

The pinned core schema defines these records:

- `user`: ID, name, email, email-verification flag, optional image, and created
  and updated timestamps.
- `session`: a unique session token, expiry, created and updated timestamps,
  optional IP address and user agent, and user ID.
- `account`: provider, issuer and provider-account identifiers, user ID,
  optional OAuth tokens and expiries, optional scope/password, and timestamps.
- `verification`: identifier, value, expiry, and timestamps.
- `rateLimit`, when database rate limiting is enabled: a unique key, count, and
  last-request timestamp.

These fields and their foreign-key cascades are defined by the pinned
[Better Auth 1.7.2 schema source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/db/get-tables.ts).
The magic-link plugin writes the token-derived identifier and a JSON value
containing email and optional name, then consumes the row on verification; it
creates a user and session but does not create an `account` row in that flow
([pinned magic-link source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/plugins/magic-link/index.ts)).

The library's cleanup is deliberately request-driven, not a complete retention
job:

- A consumed verification row is deleted, and an expired consumed row is
  rejected. A verification lookup sweeps expired verification rows only when a
  lookup occurs and `disableCleanup` is not enabled
  ([pinned internal-adapter source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/db/internal-adapter.ts)).
- An expired session is deleted when session resolution encounters it. A
  session that is never presented again is not swept by that request path
  ([pinned session-route source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/session.ts)).
- Database rate-limit rows are pruned after an elapsed-window key is reset.
  With no later qualifying request, stale rows can remain
  ([pinned rate-limiter source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/rate-limiter/index.ts)).
- The database rate-limit key is the normalized IP address and request path
  joined with `|`; it is not hashed by Better Auth
  ([pinned IP utility](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/core/src/utils/ip.ts)).
- Enabled self-deletion runs `beforeDelete`, deletes Better Auth user/account/
  session data, clears the session cookie, and then runs `afterDelete`
  ([pinned delete-user route](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/api/routes/update-user.ts),
  [pinned internal-adapter source](https://github.com/better-auth/better-auth/blob/v1.7.2/packages/better-auth/src/db/internal-adapter.ts)).

### Implementation contract

Keep Better Auth's native expiry and deletion behavior, and add one small daily
Workspace cleanup operation for deterministic minimization:

1. Delete `auth.session` rows whose `expires_at` is in the past.
2. Delete `auth.verification` rows whose `expires_at` is in the past.
3. Delete `auth.rate_limit` rows whose `last_request` is older than the longest
   configured rate-limit window.

Own the three deletes in the account backend service and invoke them from one
authenticated Vercel Cron route, following the repository's existing cron
authorization pattern. Use ordinary set-based SQL; do not add a queue, archive,
or generic retention framework. Add indexes on `session.expires_at`,
`verification.expires_at`, and `rate_limit.last_request` in the generated
Drizzle migration. Test the cutoff boundaries against Postgres and test cron
authorization/response mapping at route level.

With the approved settings, the user-facing retention statement can say:

- sessions remain valid for up to 30 days and roll forward while used;
- magic-link verification data remains valid for 10 minutes;
- expired session, verification, and IP-based rate-limit rows are removed by a
  daily cleanup job; and
- account identity rows remain until the customer deletes the account.

Do not state that expiry itself physically deletes a row immediately. The
daily sweep is what makes removal deterministic.

## Neon branch copies

A Neon child branch includes its parent's schema and all data at the branch
point, while later writes remain isolated between branches
([Neon branching workflow](https://neon.com/docs/get-started-with-neon/workflow-primer)).
Therefore, as an inference from that isolation, deleting an identity from the
production parent does not delete the already-copied row from an existing
preview child. Neon can automatically delete a branch at a configured expiry
time, including branches used for pull-request previews
([Neon branch expiration](https://neon.com/blog/expire-neon-branches-automatically)).

### Implementation contract

- Keep integration-owned preview-branch deletion enabled. Do not add an
  application job that deletes Neon preview branches.
- The account cleanup job runs against each deployment's own database. It does
  not propagate deletion across other existing branches.
- Preview E2E must use synthetic identities and addresses only.
- A preview parent that contains real customer identity data would copy that
  PII into every child and conflicts with the repository rule that previews
  never contain real PII. The compliant default is a PII-free preview parent
  (or schema-only/sanitized provisioning before a preview becomes reachable),
  not acceptance of production identity clones.

This is the only unresolved operational choice: confirm whether the current
Neon/Vercel integration forks a PII-free parent. If it forks production, choose
and document a PII-free preview source or sanitization mechanism before this
feature ships. Branch TTL limits duration but does not prevent the initial PII
copy.

## Resend message retention

Resend's DPA says its processing includes hosting or storage of message content
and lists email address, metadata, and message content among the transferred
personal data ([Resend DPA](https://resend.com/legal/dpa)). On active Free, Pro,
and Scale accounts, Resend states that email and log data is retained for 30
days and backups persist for seven days; it directs customers to contact Resend
when a specific message must be removed sooner
([Resend GDPR statement](https://resend.com/security/gdpr)). The sent-email API
can return recipients, sender, timestamp, subject, HTML/text content, delivery
event, scheduling fields, and tags
([Resend retrieve-email API](https://resend.com/docs/api-reference/emails/retrieve-email)).

### Implementation contract

- Send only the verified login address and the minimum magic-link message. Do
  not place profile, reservation, billing, or Dotypos identifiers in the
  subject, body, or tags.
- Do not mirror Resend message bodies or delivery events into Workspace.
- Treat the URL in the message as a bearer credential and keep it out of logs
  and analytics.
- Protected-preview E2E uses only Resend's synthetic test recipient, retrieves
  the message transiently, and stores neither message nor link after the run.
- Privacy copy must name Resend as the email processor and disclose the
  recipient address, message content including the magic link, delivery
  metadata, the applicable 30-day active-account retention, and seven-day
  backups. Account deletion cannot synchronously erase an already-sent email;
  use Resend's contact process only for an exceptional early-removal request.

No separate application cleanup job is needed for Resend because Workspace
does not retain a copy and Resend publishes no sent-message delete API; the
documented email mutation endpoint only cancels a scheduled message
([Resend cancel-email API](https://resend.com/docs/api-reference/emails/cancel-email)).

## Dotypos profile retention

The Dotypos Customer API documents personal/contact and billing fields,
including email, first and last name, phone, address, company and tax fields. It
also exposes `expireDate`, a `deleted` flag, and `DELETE /customers/:id` with an
optional `anonymize` query parameter
([Dotypos Customer API](https://docs.api.dotypos.com/entity/customer/)). Dotypos
also documents permanent GDPR anonymization in its Cloud interface
([Dotypos Cloud 26.5 release notes](https://manual.dotypos.com/vzdalena-sprava-26_5.html)).

The official Customer API does **not** establish any of the following:

- that setting `expireDate` starts a one-year automatic deletion policy;
- when an expired profile is physically deleted;
- which fields API `anonymize=true` removes;
- whether clearing `expireDate` is a supported reactivation contract; or
- a retention duration for merchant-created end-customer profiles.

Do not use Dotypos's general account terms as proof of end-customer retention;
they address the merchant/customer contractual account, not the documented
lifecycle of Customer API rows
([Dotypos general terms](https://www.dotypos.com/general-terms-and-conditions-software-product/)).

### Implementation contract

Keep the approved two-system ownership boundary:

- Better Auth owns authentication and its account identity.
- Dotypos owns profile fields and reservation history.
- Workspace owns only the opaque Better Auth-to-Dotypos link plus deletion
  workflow state needed to resume an interrupted deletion.

On account deletion, first set the Dotypos profile's `expireDate`, then delete
the Better Auth account and local link. Do not delete or anonymize the Dotypos
customer or historical reservation, payment, invoice, or legal records. If the
Dotypos step fails, keep the account/link and return the approved retryable
failure; if Better Auth deletion fails after expiry, keep explicit interrupted
state so retry resumes rather than creating a second profile.

Privacy copy may say that account deletion disables/expires the Dotypos profile
and removes the live Workspace login account. It must not promise automatic
Dotypos deletion after one year unless Dotypos confirms that policy for this
specific merchant account in a durable contractual or support source.

The remaining product decision is whether the public policy should avoid a
duration entirely (recommended) or whether the operator will obtain written
Dotypos confirmation before promising the stated one-year cleanup. This does
not block implementation of expiry-based account deletion.

## Disclosure and test ownership

Update both `en-US` and `cs-CZ` sections in
`apps/deskohub-workspace/features/legal/content.tsx` in the same change. Cover
the system ownership and retention facts above without claiming that account
deletion removes retained commercial records.

The minimum verification set is:

- schema snapshot/migration test for the three cleanup indexes;
- Postgres integration test for cleanup cutoffs and account/link deletion;
- service tests for Dotypos-first deletion and interrupted retry;
- route test for cron authorization;
- E2E assertion that deletion removes the live account/link and prevents the
  old session from being reused, while retained reservation facts remain; and
- static legal-content assertions that both locales name Better Auth data in
  Neon Postgres, Dotypos profile/history ownership, Resend processing, and the
  non-immediate provider/backup limitations.

