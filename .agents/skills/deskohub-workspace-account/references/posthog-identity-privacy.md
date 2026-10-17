# PostHog identity and privacy

Code: `features/account/analytics-identity.ts`,
`features/account/analytics-customer-link.ts`,
`features/cookie-consent/components/posthog-analytics.tsx`, and
`features/cookie-consent/utils/` (`posthog-config.ts`, `posthog-identity.ts`).

## Account identity contract

- The account analytics boundary publishes only `pending`, `unavailable`,
  `anonymous`, or `authenticated`, plus the opaque `CustomerAccountId` and the
  `testAccount` boolean when authenticated. Better Auth session and user
  details stay private.
- The app has one root `PostHogProvider` (`app/[locale]/layout.tsx`).
  Initialize PostHog only after analytics consent.
- Derive the distinct ID with `getPostHogAccountDistinctId`, and call
  `identify(id)` without properties. A consented anonymous browser history may
  merge into the account at that call.
- Pseudonymous account and customer identifiers may become person properties
  after analytics consent; contact PII may not. Once the account identity is
  ready, `requestAnalyticsDotyposCustomerId` loads the account's existing
  Dotypos customer ID from `GET /api/account/customer-link`
  (`features/account/backend/account-customer-link.ts`). That route checks the
  authoritative session, reads the link without claiming one, reports none for
  an account awaiting deletion, and returns only the two IDs. The identity
  controller then sets the `dotypos_customer_id` person property
  (`setPersonProperties`) once per SDK identity, including on a restored
  session. An account without a customer sends nothing. A known link is kept
  for the page; a missing one is asked for again on the next ready identity
  (focus, visibility, or `SessionRefresh`), and profile completion calls
  `refreshAnalyticsDotyposCustomerId` because it creates the customer.
  Analysts join PostHog persons to Dotypos records through this ID, so
  PostHog never needs the profile itself.
- `testAccount` is true only when the verified login email is on the reserved
  test domain (`isTestEmailAddress` from `@deskohub/test-email`). Mail there is
  never delivered, so only fixtures and E2E can hold such an account, and a
  visitor can't flag anyone else. The identity controller then calls the SDK's
  `setInternalOrTestUser()`, which sets the `$internal_or_test_user` person
  property that the PostHog "Internal / Test users" cohort matches. Don't
  derive it from a request header, cookie, query parameter, or hostname, and
  don't use the SDK's `internal_or_test_user_hostname` option: it fires at
  load, before consent and identity settle. E2E cases accept only necessary
  cookies, so they create no PostHog persons unless a case opts in to
  analytics.

## Deployment environment tagging

Preview (including CI E2E), development, and production share one PostHog
project so feature flags live in one place. Tags, not separate projects, set
non-production traffic apart:

- Every server event (`posthog-event.service.ts`), browser event, and browser
  log carries `deployment.environment.name`, set to the `VERCEL_ENV` value
  (`production`, `preview`, or `development`). The root layout passes the
  server's `env.VERCEL_ENV` to `ConsentAwareAnalytics` as
  `posthogEnvironment`, typed `DeploymentEnvironment`. The browser
  `before_send` adds the property to every event it lets through, including
  `$pageview`, `$identify`, and the `$set` from `setInternalOrTestUser()`.
  `captureLog` bypasses `before_send`, so the log sink adds it itself. Don't
  read a second environment variable for analytics, and never take the value
  from the request.
- The identity controller calls `setInternalOrTestUser()` for every
  identified person on a non-production deployment and for test accounts on
  any deployment. It never marks an ordinary production account. Anonymous
  visitors have no person profile (`identified_only`), so their events rely
  on the event property.
- The PostHog project must keep `deployment.environment.name = production`
  in its "Filter out internal and test users" settings. The setting lives in
  PostHog, not the repo. Together with the `$internal_or_test_user` cohort,
  one toggle then excludes Preview, E2E, and development traffic.

## Identity transitions

- Reset the previous identity before opting in capture for a different account,
  and after confirmed logout, account deletion, or session expiry. Reset before
  opting out when consent is withdrawn.
- Pause analytics while auth is `pending` or `unavailable`, and don't repeat
  resets while authority is uncertain. A failed logout refreshes authority and
  doesn't reset early.
- Callers use `beginAnalyticsAccountTransition`,
  `completeAnalyticsAccountSignOut`, and `refreshAnalyticsAccountIdentity`.
  A plain refresh keeps an unresolved mutation barrier, so focus refreshes and
  `SessionRefresh` can't resume analytics mid-mutation. A failed logout or
  deletion, or a completed outcome that didn't delete the account, calls
  `refreshAnalyticsAccountIdentity({ settleTransition: true })`. Confirmed
  success calls `completeAnalyticsAccountSignOut`.
- Refresh authoritative session state on mount, focus or visibility recovery,
  and cross-tab auth signals. Publish `pending` during the refresh and
  `unavailable` after an authority failure.
- Settled identity changes (login, account switch, expiry) and confirmed
  termination emit a same-origin notification; a same-account refresh
  doesn't. The account and consent `localStorage` signals carry only random
  nonces, never IDs, profile data, payloads, or timestamps. A consent
  withdrawal in another tab stops the SDK at once; reconsent verifies fresh
  auth before enabling it.
- better-auth's `useSession` `refetch` resolves even when the request fails and
  records the failure on the atom's `error`. Report
  `account.analytics-session.refresh-failed` for both a rejected refetch and
  one that resolves with an error.

## Event and property limits

- Keep session replay, autocapture, exception capture, heatmaps, and surveys
  disabled so profile, billing, and PIN values never enter PostHog.
- Redact URL query strings, hashes, credentials, and operational path
  identifiers. Apply the URL cleanup to current, initial, and
  `$session_entry_*` variants, including session-entry campaign fields;
  disabled replay doesn't suppress session metadata. Drop malformed metadata,
  and remove saved UTM and click metadata.
- Don't describe network IP handling as disabled.
- Person properties never include email, name, phone, billing, reservation
  IDs, or raw auth data. The signed-in account's `dotypos_customer_id` is the
  only customer identifier allowed. Don't alias a browser to a reservation.
  Customer contact data reaches PostHog only as rows of the Dotypos customer
  warehouse table (see below), joined to persons at query time, never as
  person or event properties.
- Guest checkouts create or reuse a Dotypos customer found by the entered
  email, so a guest browser isn't linked to it: anyone can type another
  customer's email, and linking would need a person profile for an
  `identified_only` anonymous visitor. Join guest activity through the
  reservation ID on server events and `workspace_reservations` instead.
- Server events set `$process_person_profile: false` and may keep the
  reservation and payment operational IDs that existing durable metrics need.
  Consented request events use the browser's `distinct_id` and `$session_id`.
  Webhooks can't join a browser without an approved persisted consent link.
- Sign-in analytics live in `features/account/sign-in-analytics.ts`:
  `sign-in completed` with `method: "link" | "code" | "passkey"`, `sign-in
  code rejected` with `reason`, `passkey added` with `source: "prompt" |
  "settings"`, `passkey removed`, and `passkey prompt dismissed`. PostHog drops events until the new account identity
  settles on the next page, so a finished sign-in is recorded in the tab's
  sessionStorage (only with analytics consent) and captured from the PostHog
  ready handler once the identity is authenticated. Never add the email or
  code to these payloads.
- Browser failure reports (`reportWorkspaceBrowserFailure`) reach PostHog Logs
  through `posthog.captureLog` only while analytics is ready (consented, with
  a settled identity). `captureLog` bypasses `before_send`, so the sink
  overrides `url.full` with the sanitized page URL and adds
  `deployment.environment.name`. A record holds only the operation, boundary,
  failure code, an allowlisted error type (else `unclassified`), and an HTTP
  status.
- Records reported while analytics is paused wait in an in-memory outbox of 50
  and go out once analytics is ready, under whichever distinct ID is ready
  then. Every reconcile without consent or with an unsafe telemetry host
  discards them. They don't survive a page load.

## Flag-request gotcha

The SDK's `/flags` request bypasses `before_send` and merges persisted
`$initial_person_info`, `$initial_referrer_info`, and
`$initial_campaign_params`, even with the `save_*` options off. Right after
`init`, and again before re-enabling or reloading flags, call `unregister`
for exactly those three keys. This keeps the `distinct_id` and history and
doesn't touch remote data.

## Ingest host isolation

Better Auth cookies are host-only, and the SDK has no option to omit
credentials (`fetch` uses same-origin credentials and Beacon may send them).
`isPostHogTelemetryHostAllowed` fails closed before SDK init when the ingest
hostname matches the app hostname (on any port), or the ingest URL is
relative, same-origin, non-HTTP(S), or has userinfo. Keep the public UI
working instead of throwing, and never fall back to a same-host proxy.

## Dotypos customer warehouse source

PostHog's Custom REST source pulls an allowlisted set of Dotypos customer
fields, including contact data, from a production-only Workspace route into a
`custom.dotypos_customers` warehouse table. Analysts join it to persons on
`properties.dotypos_customer_id`. The legal basis is legitimate interest, so
it covers every Dotypos customer regardless of cookie consent; the privacy
policy (`features/legal/content.tsx`, both locales) discloses the fields and
the right to object. Deleted customers stay as rows with `deleted: true`, and
PostHog's settings govern retention, as for other analytics data.
Staff can record an objection with the Dotypos `no-analytics` tag, which
blanks the row and marks it deleted on the next sync.

- The response schema is the field allowlist. Adding a field needs the user's
  approval and a matching privacy-policy change.
- Customer data passes through request memory only: never store, cache, or log
  it in Workspace, Neon, or a bucket.
- Contract, access, and PostHog setup live in the `deskohub-dotypos` skill's
  [PostHog customer source](../../deskohub-dotypos/references/posthog-customer-source.md)
  reference.

## Not part of this integration

- No auth or user database connector, other warehouse sync, or bulk export. A
  default Postgres sync would export auth PII and secrets. Any further export
  needs an approved purpose, property list, retention rule, and root policy
  first.
- Don't enable `ensure_experience_continuity`, change `person_profiles` from
  `identified_only`, or add device bucketing without a root decision.
  Changing the distinct ID can move a percentage-rollout bucket, so keep
  account rollouts global on or off.

## Retention

PostHog `reset` changes only local identity state; it doesn't delete remote
events or unmerge aliases. Public legal copy uses generic provider-settings
language for analytics retention; don't promise deletion deadlines. How
PostHog erasure requests are handled is the project owner's decision and must
not block account deletion. Better Auth retention is in
[privacy and retention](privacy-and-retention.md).

## Verification

From `apps/deskohub-workspace`, run `bun scripts/posthog-identity-browser.ts`.
It uses a local fake ingest and synthetic identities, and fails unless the
installed SDK and every event's `$lib_version` match the pinned `posthog-js`
version. CI doesn't run it, so `scripts/posthog-sdk-version.test.ts` keeps the
pin exact. Run the browser script on every SDK upgrade and check flag,
remote-configuration, capture, and replay payloads.
