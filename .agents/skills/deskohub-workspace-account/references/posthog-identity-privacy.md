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
- Browser checkout events carry no reservation form values (name, email,
  phone, message, date, tier, or coffee and monitor preferences). The
  PostHog `pre-payment outcome` event's only custom property is its outcome;
  the Vercel Analytics `workspace_checkout_started` event's custom properties
  are only the five `utm_*` keys allowlisted in `features/reservation/reservation-analytics.ts`, each
  trimmed to 128 characters.
- Don't describe network IP handling as disabled.
- Person properties never include email, name, phone, billing, reservation
  IDs, or raw auth data. The signed-in account's `dotypos_customer_id` is the
  only customer identifier allowed. Don't alias a browser to a reservation.
  Customer contact data reaches PostHog only as rows of the Dotypos customer
  warehouse table (see below), joined to persons at query time, never as
  person or event properties.
- Booking for someone else creates or reuses a Dotypos customer found by the
  typed email, so the booker's browser isn't linked to it: anyone can type
  another customer's email. Join that customer's activity through the
  reservation ID on server events and `workspace_reservations` instead.
- Server events set `$process_person_profile: false`. The reservation and
  payment lifecycle events follow the contract in
  [Reservation and payment lifecycle events](#reservation-and-payment-lifecycle-events).
  The consented request events (`availability result`, `pre-payment outcome`)
  use the browser's `distinct_id` and `$session_id`, and are skipped without
  analytics consent. Webhooks can't join a browser without an approved
  persisted consent link.
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

## Reservation and payment lifecycle events

`features/checkout/backend/analytics/posthog-lifecycle-events.ts` sends
`reservation started`, `reservation completed`, `reservation fulfilled`,
`reservation abandoned`, `payment started`, `payment completed`,
`payment failed`, and `payment abandoned` regardless of consent. Their legal
basis is legitimate interest in measuring the reservation and payment funnel
and detecting failed or abandoned payments. The privacy policy discloses them
in section 3 and their basis and the right to object in section 4
(`features/legal/content.tsx`, both locales). The notice promises that the
records are linked to the reservation and hold no name or contact details.
Section 2's automated-traffic paragraph also discloses that they carry the
traffic category and the name of a recognized assistant.

- The distinct ID is the Workspace reservation ID, and every event sets
  `$process_person_profile: false`. The event UUID is
  `<reservation or payment attempt ID>:<event>`.
- Allowed properties: `reservation_id`; on payment events also
  `payment_attempt_id`, `revenue` (major units), `currency`, and `provider`;
  `failure_reason` on `payment failed`; `agent_category` and, when
  recognized, `agent_name` (from `agentTrafficProperties()`, disclosed in
  section 2). The event service adds
  `deployment.environment.name`, `service.name`, `service.namespace`,
  `effect.trace_id`, and `effect.span_id`, and the SDK adds its `$lib` fields
  and `$geoip_disable`. The colocated tests pin the exact key sets.
- Never send provider order IDs, Dotypos reservation or customer IDs,
  account IDs, browser distinct IDs or `$session_id`, `$set` or other person
  properties, URLs, or UTM and click parameters. The input types take only
  the reservation ID and the attempt fields above, so callers can't pass
  another identifier through.
- GeoIP stays disabled through the `posthog-node` default (`disableGeoip`
  defaults to true and each capture gets `$geoip_disable: true`). Don't add
  an explicit option; never set `disableGeoip: false` on the server client.
- Before adding a property, check it against the notice's promise. A new
  identifier, contact field, or other kind of data needs a matching
  privacy-policy change and the user's approval. If the agent fields change,
  such as dropping `agent_name` or adding another one, change the section 2
  wording to match.
- Objections are handled manually; there's no opt-out code path. A customer
  objects by email to the controller's contact address with their
  reservation. An operator then has the reservation's events deleted in
  PostHog. These events have no person profile, so the Persons UI and the
  person delete API (`delete_events=true`) can't reach them, and PostHog
  documents no self-serve deletion of personless events. Ask PostHog support
  to delete events with `distinct_id` equal to the reservation ID in project
  `204184`, then confirm with a HogQL count of `events` for that
  `distinct_id` once the deletion has run (PostHog deletes event data
  asynchronously, on weekends on Cloud). Recheck after the reservation
  settles, since an open reservation can still emit events.

## Agent traffic

- `shared/agent-traffic/agent-traffic.ts` classifies a request into a fixed
  `agent_category` and an allow-listed `agent_name` from `User-Agent`,
  `Signature-Agent`, and BotID's verified-bot name and category. Unknown names
  become `other`. Never record those raw values or an IP.
- Every boundary classifies the request's own `User-Agent` and
  `Signature-Agent` headers: the proxy for page loads,
  `withWorkspaceRequestContext` for Server Actions and `client` routes, and
  the Better Auth guard. The result goes into request context
  (`CurrentAgentTraffic`). Nothing forwards a category between boundaries,
  and the proxy matcher skips dotted paths, so never read a category from a
  request header.
- `agent page request` (proxy, document navigations that reach a render),
  `agent tool call` (each MCP tool call, from `agent-tool-mcp-handler.ts`),
  and `bot protection rejection` (BotID) events go out after the response,
  regardless of consent, from `shared/backend/agent-traffic/agent-traffic-events.ts`
  with a random per-event distinct ID and `$process_person_profile: false`.
  They carry only the agent fields, route template, locale, tool name,
  outcome (`success` or the tool's error code), call site, and
  `verified_bot`. The page route is a template Next generated from the app
  directory (`AppRoutes`) without its locale segment; a path no page matches
  is `unknown`, so a requested path value never reaches PostHog. The privacy
  policy describes these events in plain terms; a property that sends a new
  kind of data needs a matching policy change.
- Checkout lifecycle events carry the agent fields of the request that
  emitted them. Actions and `client` routes provide request context
  themselves; a page whose run can emit one, such as the checkout status
  page that finalizes payments, passes its own `headers()` to
  `withWorkspaceRequestContext`. Work that serves no customer request is `unclassified`
  without a name: tasks, and `service` routes (webhooks, crons, warehouse
  pulls). Attribute those events to the customer's traffic in PostHog through
  the reservation's shared distinct ID; never persist a category on the
  reservation.

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
