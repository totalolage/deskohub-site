# PostHog identity and privacy

Code: `features/account/analytics-identity.ts`,
`features/account/analytics-customer-link.ts`,
`features/account/posthog-account-distinct-id.ts`,
`features/cookie-consent/browser-analytics-session.ts`,
`features/cookie-consent/components/posthog-analytics.tsx`, and
`features/cookie-consent/utils/` (`posthog-config.ts`, `posthog-identity.ts`).

The mobile app follows the same rules with `posthog-react-native`; its SDK,
consent storage and events are in the `deskohub-mobile` skill
(`references/analytics.md`).

## Browser analytics session

- `createBrowserAnalyticsSession` owns the page's one PostHog lifecycle: SDK
  load and init, the telemetry-host pause, consent withdrawal, identity
  reconcile, pageview dedup, the session-cookie mirror, and delivery of held
  events and browser logs. `posthog-js` stays private to it; never pass the
  SDK or a `Pick<PostHog>` into other modules.
- `posthog-analytics.tsx` only binds it to React: one effect calls `sync`
  with the render's settings (consent signal, pathname, flag overrides,
  host, token, environment), then one mount effect calls `connect`, which
  follows identity, customer-link and consent changes and pauses, without
  resetting, on disconnect. Keep `sync` before `connect` so connecting starts
  the SDK with current settings. Unchanged settings do nothing, so Strict
  Mode's repeated effects don't re-init, re-identify or repeat pageviews.
- The identity controller answers readiness (`isReadyFor`): settled on that
  identity and the SDK still holds it. Don't re-derive readiness from SDK
  reads elsewhere.

## Visitor consent

- `features/cookie-consent/visitor-consent.ts` owns browser consent: read it
  through `visitorConsent.accepts` or `useVisitorConsent` (false on the server
  and during hydration), and listen with `visitorConsent.subscribe`, never by
  parsing `cc_cookie` or adding `consentUpdated`, `storage`, or focus
  listeners. The browser and the server (`shared/backend/analytics/visitor-identity.ts`)
  share the strict reader in `shared/utils/consent-cookie.ts`: a category
  counts only when every cookie copy is well-formed and accepts it.
- `ConsentBanner` alone runs vanilla-cookieconsent and maps categories to
  Google consent mode (`utils/google-consent-mode.ts`). After each saved
  consent it queues one `gtag` update per optional category, then fires the
  synchronous `consentUpdated` app event and cross-tab ping; the
  `consent_update` dataLayer event follows in a microtask, for first consent
  and changes only. Externally managed tags rely on that order.
- `getConsentBannerRevision` (`features/legal/consent-banner-revision.ts`)
  derives the banner's `revision` from the privacy notice and cookie policy
  versions of every locale, so a change to either document re-prompts every
  visitor. It hashes the committed `consentBannerDocumentVersions` copy, not
  the legal texts, because the server's consent readers sit in graphs (such
  as the release-gate runs) that must not load React or `content.tsx`. When
  either document changes, paste the versions the failing
  `consent-banner-revision.test.ts` parity test prints into that table in the
  same change; never import `document-version.ts` there. The `shared/utils/consent-cookie.ts` readers take that revision,
  and a cookie copy saved under another revision holds no choice: the browser
  shows the banner again, and the server mirrors nothing from it into the
  ledger and lets no visitor capture through. The consent modal footer and
  the preferences modal link to both documents.
- Silent grant: when a signed-in session hydrates on a device that holds no
  consent cookie at all (a new device or cleared cookies) and the account's
  current decision is a grant whose notice hash is the current privacy
  notice of the decision's locale, Workspace writes the cookie with analytics
  accepted and every other optional category declined, and shows no banner.
  `resolveSilentAnalyticsGrant`
  (`features/legal/backend/analytics-consent-mirror.ts`, reached through the
  `resolveSilentAnalyticsGrantForDevice` action) decides it, and
  `visitorConsent.applyAccountGrant` writes the cookie dated at the grant's
  `decided_at`, so a later mirror neither duplicates the grant nor outranks a
  newer decision. The change is announced as an `account` change, which the
  mirror component doesn't record as a banner save. A withdrawal, a grant
  under an older notice hash, or no decision shows the banner instead. So
  does a device holding a cookie saved under an earlier banner revision,
  whatever the account decided. The cookie stays after sign-out, like any
  other choice.
- Known limit: the ledger records only the privacy notice hash, so after a
  change to the cookie policy alone a new device still gets a silent grant
  from a grant given under the earlier cookie policy.

## Account analytics consent ledger

- The account keeps every analytics consent decision it made in
  `account_analytics_consent_decisions`: grant or withdrawal, the privacy
  notice hash and locale it was given under, when it was made, and its
  source. It exists so the server can read a booker's current decision
  without a browser; the vocabulary and ordering rules are in the
  `deskohub-workspace-domain` skill's
  [analytics consent](../../deskohub-workspace-domain/references/analytics-consent.md)
  reference.
- The strict reader's `readConsentCookieChoice` also returns the cookie's
  `lastConsentTimestamp` and `languageCode`; mirrors date a decision at that
  timestamp. Browser and server keep using the one reader.
- The ledger is written at sign-in (Better Auth's session create hook), when
  a signed-in page hydrates or the visitor saves the banner in that tab
  (`AccountAnalyticsConsentMirror` calling `recordDeviceAnalyticsConsent`),
  and in Pay-state preparation. A customer agent's booking carries no device
  choice and mirrors nothing.
- The native app reaches the ledger through the customer HTTP API's
  `account` group. `POST /api/customer/account/analytics-consent`
  (`syncAnalyticsConsent`) sends the app's own choice (`analytics`, the
  device's `decidedAt`) or null, and the app locale.
  `syncAppAnalyticsConsent` (`analytics-consent-mirror.ts`) mirrors a choice
  with source `app_mirror` under the web's mirror rules, then answers
  `withdraw` (the web's cross-device withdrawal: the app accepts analytics and
  didn't outrank the account's withdrawal), `grant` (the web's silent grant:
  the app holds no choice and the current decision is a current-notice
  grant), or `unchanged`. `GET`/`PUT /api/customer/account/analytics-preference`
  read and save the analytics preference through `readAnalyticsPreference` and
  `saveAnalyticsPreference`, so the app's opt-out also requests
  anonymisation. Answered instants are truncated to the millisecond, so the
  app's stored copy never outranks the decision it copies and syncing it back
  appends nothing. A pending account deletion answers 409
  `CustomerAccountLinkRequired` (`deletion-pending`); a ledger failure answers
  503, never "off".
- The ledger's rows never reach PostHog. The author's current decision
  decides whether lifecycle events are person-linked
  ([lifecycle events](#reservation-and-payment-lifecycle-events)), and an
  account's current-notice grant gives a new device a silent grant
  ([visitor consent](#visitor-consent)).
- Rows cascade with the `auth.user` row when the account is deleted.

## Account identity contract

- The account analytics boundary publishes only `pending`, `unavailable`,
  `anonymous`, or `authenticated`, plus the opaque `CustomerAccountId` and the
  `testAccount` boolean when authenticated. Better Auth session and user
  details stay private.
- The app has one root `PostHogProvider` (`app/[locale]/layout.tsx`).
  Initialize PostHog only after analytics consent.
- The browser SDK isn't in the initial bundle. The browser analytics session
  loads `posthog-js` with a dynamic import once consent and a safe telemetry host
  allow initialization; the `no-eager-posthog-browser-sdk` lint rule rejects
  static value imports of `posthog-js` or `@posthog/react` (which imports the
  SDK at module load) in Workspace and `@deskohub/posthog` source. Use
  `import type` for SDK types.
- Capture browser events with `captureAnalyticsEvent`
  (`features/cookie-consent/analytics-events.ts`), never the SDK directly.
  Without an analytics consent cookie it keeps nothing. Otherwise the event
  waits in an in-memory outbox of 50 until analytics is ready (SDK loaded,
  consented, identity settled), then goes out after the ready `$pageview` in
  capture order, also across pauses such as a focus refresh. Every reconcile
  without consent or with an unsafe telemetry host discards held events, and
  so does a ready identity that replaces an authenticated one (sign-out or
  account switch), so an account's events never follow the visitor to the
  reset identity.
- In the browser, only the identity controller derives the distinct ID
  (`workspace-account:<CustomerAccountId>`, from `getPostHogAccountDistinctId`,
  which server capture shares), and it calls `identify(id)` without
  properties. A consented anonymous browser history may merge into the
  account at that call.
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

- Every server event (`server-analytics.service.ts`), browser event, and browser
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
- Account exits go through `features/account/account-exit.ts`, which owns
  the transition order. Sign-out calls `signOutOfAccount` and leaves the page
  only on `"signed-out"`. Deletion calls `beginAccountExit()` on confirm, then
  the handle's `left()` on a deleted outcome, before leaving the page, or
  `stayed()` for any other outcome or a failed request. The first call
  settles the exit; later calls do nothing. `left` runs
  `completeAnalyticsAccountSignOut`, and `stayed` runs
  `refreshAnalyticsAccountIdentity({ settleTransition: true })`. Don't call
  the analytics transition primitives from components or fixtures.
- A plain `refreshAnalyticsAccountIdentity()` keeps an unresolved mutation
  barrier, so focus refreshes and `SessionRefresh` can't resume analytics
  mid-mutation. It never rejects: a failed refresh publishes `unavailable` and
  reports its own failure log, so callers neither catch nor report it.
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
  PostHog `pre-payment outcome` event's only custom property is its outcome.
  The Vercel Analytics
  `workspace_checkout_started` event's custom properties are only the five
  `utm_*` keys allowlisted in `features/reservation/reservation-analytics.ts`,
  each trimmed to 128 characters.
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
- Server events set `$process_person_profile: false`, except person-linked
  lifecycle events. The reservation and payment lifecycle events follow the
  contract in
  [Reservation and payment lifecycle events](#reservation-and-payment-lifecycle-events).
  The consented request events (`availability result`, `pre-payment outcome`)
  use the browser's `distinct_id` and `$session_id`, and are skipped without
  analytics consent. Webhooks carry no browser session ID; their lifecycle
  events follow the author's ledger decision like every other capture.
- Sign-in analytics live in `features/account/sign-in-analytics.ts`:
  `sign-in completed` with `method: "link" | "code" | "passkey"` (the app
  also sends `continue`, see the `deskohub-mobile` skill's
  `references/analytics.md`), `sign-in code rejected` with `reason`, `passkey added` with `source: "prompt" |
  "settings"`, `passkey removed`, and `passkey prompt dismissed`. The new account identity
  settles only on the next page, so a finished sign-in is recorded in the tab's
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

`CheckoutAnalytics` (`features/checkout/backend/analytics/checkout-analytics.service.ts`)
sends `reservation started`, `reservation completed`, `reservation fulfilled`,
`reservation abandoned`, `payment started`, `payment completed`,
`payment failed`, and `payment abandoned` regardless of consent. Recording
them rests on legitimate interest in measuring the reservation and payment
funnel and detecting failed or abandoned payments; linking them to the
account's analytics profile rests on analytics consent. The privacy policy
discloses them in section 3, the link in sections 2 and 3, and both bases and
the right to object in section 4 (`features/legal/content.tsx`, both
locales); the cookie policy's analytics category names the link too. The
notice promises that the records are linked to the reservation and, with
analytics consent, to the account's analytics profile, and hold no name or
contact details. Section 2's automated-traffic paragraph also discloses that
they carry the traffic category and the name of a recognized assistant.

- Each event is either person-linked or reservation-keyed. A person-linked
  event (`ServerAnalytics` subject `account`) has the distinct ID
  `workspace-account:<authorAccountId>` from `getPostHogAccountDistinctId`,
  the browser's identity for the same account. It omits
  `$process_person_profile`, so PostHog processes the person, and keeps
  `reservation_id` as a property. A reservation-keyed event (subject
  `record`) has the Workspace reservation ID as distinct ID and sets
  `$process_person_profile: false`. Neither carries `$session_id`.
- The capture-time rule picks the branch for every event, webhook captures
  included. `ReservationAnalyticsPerson.linkedAccount`
  (`features/checkout/backend/analytics/reservation-analytics-person.ts`)
  reads the reservation's stored author, then the author's current decision
  in the ledger, once per reservation per Workspace run. A grant links,
  including a grant under an older notice hash, until the account answers
  again. A withdrawal or no decision keeps the event reservation-keyed. A
  failed read does too, and logs a warning. So a withdrawal after
  `reservation started` makes events captured in later runs
  reservation-keyed, and a reservation's events can mix both branches.
- The capture hands `posthog-node` the
  event UUID `<reservation or payment attempt ID>:<event>`, but the SDK sends
  a random UUIDv7 in place of any value that isn't a UUID, so PostHog doesn't
  deduplicate a repeated capture by it.
- The event names live in `features/checkout/reservation-lifecycle-events.ts`,
  which the administration's reservation history
  (`features/administration/posthog-reservation-history.ts`) reads them back
  by. Add or rename an event there, never as a string in either module. The
  history filters by the `reservation_id` property only, which both branches
  carry, never by distinct ID.
- Allowed properties: `reservation_id`; on payment events also
  `payment_attempt_id`, `revenue` (major units), `currency`, and `provider`;
  `failure_reason` on `payment failed`; `agent_category` and, when
  recognized, `agent_name` (from `agentTrafficProperties()`, disclosed in
  section 2). The event service adds
  `deployment.environment.name`, `service.name`, `service.namespace`,
  `effect.trace_id`, and `effect.span_id`, and the SDK adds its `$lib` fields
  and `$geoip_disable`. The colocated tests pin the exact key sets.
- Never send provider order IDs, Dotypos reservation or customer IDs,
  account IDs as properties, `$session_id`, `$set` or other person
  properties, URLs, or UTM and click parameters. The account ID appears only
  inside a person-linked event's distinct ID. The input types take only the
  reservation ID and the attempt fields above, so callers can't pass another
  identifier through.
- GeoIP stays disabled through the `posthog-node` default (`disableGeoip`
  defaults to true and each capture gets `$geoip_disable: true`). Don't add
  an explicit option; never set `disableGeoip: false` on the server client.
- Before adding a property, check it against the notice's promise. A new
  identifier, contact field, or other kind of data needs a matching
  privacy-policy change and the user's approval. If the agent fields change,
  such as dropping `agent_name` or adding another one, change the section 2
  wording to match.
- An objection to person-linked events is self-serve. The customer turns
  analytics off in the account preference on `/account/legal`, which records
  the withdrawal, makes the account's later lifecycle events
  reservation-keyed, and deletes the account's PostHog person while keeping
  its events ([person anonymisation](#person-anonymisation)). Account deletion
  deletes the person the same way.
- Reservation-keyed events have no person profile, so neither the preference
  nor the Persons UI or person delete API can reach them, and PostHog
  documents no self-serve deletion of personless events. A customer objects
  to them by email to the controller's contact address with their
  reservation. An operator then asks PostHog support to delete events whose
  `properties.reservation_id` equals the reservation ID in project `204184`;
  matching `distinct_id` misses the reservation's person-linked events.
  Confirm with a HogQL count of `events` for that property once the deletion
  has run (PostHog deletes event data asynchronously, on weekends on Cloud).
  Recheck after the reservation settles, since an open reservation can still
  emit events. This covers every reservation-keyed event: from before a
  grant, after a withdrawal, or from a failed ledger read.
- After anonymisation the person is gone, so the retained person-linked
  events can't be deleted through the person delete API
  (`delete_events=true`) either. A request to erase them goes to PostHog
  support too. Give `distinct_id` `workspace-account:<accountId>` as the
  starting selector, and have support confirm it also covers the anonymous
  history merged into the account at identify (see
  [account identity contract](#account-identity-contract)); PostHog has not
  confirmed it can erase events for a deleted person, so promise no outcome.

## Funnel insights

Filter every step to `deployment.environment.name = production`.

- Person funnel, consented visitors: `$pageview` → `$pageview` where
  `$pathname` contains `/reservation/` → `reservation started` → `payment
  started` → `payment completed`, aggregated by person. The browser steps and
  the person-linked lifecycle steps share the account person, so it counts
  signed-in bookers whose current decision is a grant; reservation-keyed
  events have no person and drop out.
- Reservation-ID funnel, all bookings: `reservation started` → `payment
  started` → `payment completed`, aggregated by the HogQL expression
  `properties.reservation_id`. Both branches carry the property, so it counts
  every reservation, consented or not.

## Server capture

- Server events go out only through typed domain operations:
  `CheckoutAnalytics` and `AgentTrafficEvents`
  (`shared/backend/agent-traffic/agent-traffic-events.ts`). Their inputs
  take only the identifiers the event may carry. Each wraps
  `ServerAnalytics` (`shared/backend/analytics/server-analytics.service.ts`),
  whose subject policy sets the distinct ID, UUID, agent fields,
  `$session_id`, and person processing: `account` (a person-linked
  lifecycle event), `record` (a reservation-keyed lifecycle event), the
  request's consented `visitor` (skipped without one), or `anonymous` (a
  random distinct ID per event). `CheckoutAnalytics` picks `account` or
  `record` by the capture-time rule. Don't call
  `ServerAnalytics` from anywhere else; add a domain operation instead.
- Capture never fails the work it's part of and never waits for PostHog: it
  queues the event on one `posthog-node` client per process
  (`analytics-event-delivery.service.ts`), separate from the feature-flag
  client. Every Workspace run's telemetry flush sends the queue: after the
  response for pages, actions, routes, and web handlers, and before settling
  for tasks and work that already runs after the response, such as agent
  traffic events. The client's `waitUntil` hook keeps the invocation alive
  until its debounced flush for an event a flush misses.
- In tests, provide `recordCheckoutAnalytics()` or `recordServerAnalytics()`
  (the adjacent `*.service.mock.ts` files): the real subject policy over a
  delivery that records each event as PostHog would receive it.

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
  the shared `reservation_id` property; never persist a category on the
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

## Person anonymisation

`AnalyticsPersonAnonymisation`
(`features/account/backend/analytics-person-anonymisation.ts`) deletes the
PostHog person `workspace-account:<accountId>`, with its person properties
and distinct IDs, and keeps its events and recordings. It calls
`PostHogPersonsService.deletePersonKeepingEvents` from
`@deskohub/posthog/persons`, which sends `POST
/api/projects/<projectId>/persons/bulk_delete/` with `delete_events: false`
and `delete_recordings: false`. The kept events stay queryable as
pseudonymous records keyed by the account's distinct ID and, on lifecycle
events, `properties.reservation_id`. It sends nothing else to PostHog.

- Two entry points. Account deletion calls `anonymiseDeletedAccount` after
  the tombstone, and only when every earlier step succeeded
  (`customer-account-deletion.ts`); the deletion is unconditional. Turning
  the account preference off calls `anonymiseWithdrawnAccount`; the
  preference, the device cookie, and cross-device withdrawal on the next
  signed-in page load are in [account domain and
  routes](account-domain-and-routes.md) and the `deskohub-workspace-domain`
  skill's
  [analytics consent](../../deskohub-workspace-domain/references/analytics-consent.md)
  reference.
- A withdrawal's deletion re-reads the ledger before each attempt and sends
  nothing unless the account's current decision is still a withdrawal. A
  later grant, an empty ledger (its rows went with a deleted account), or a
  failed read skips it.
- Best effort: both run after the response through
  `runWorkspaceEffectAfterResponse`, and neither fails nor delays its caller.
  Each outcome logs a stable `code` and never the account ID, distinct ID,
  key, or response body: `posthog_person_anonymised`, `…_absent` (no person),
  `…_skipped`, `…_ledger_unavailable`, `…_uncertain`, `…_failed`, and
  `…_unavailable`.
- Retries cover only failures that prove nothing was applied: 429, and a 202
  whose `deletion_errors` name a step other than `log_activity` or
  `publish_clickhouse_tombstone`. The ceiling is the private table in
  `packages/posthog/src/persons`. A server error, timeout, or lost
  connection may have applied, so it runs once and logs `…_uncertain`. An
  attempt waits 5 seconds in production and 30 elsewhere, and
  `posthog-person-privacy.config.test.ts` keeps the retried worst case inside
  the 240-second after-response budget.
- Configuration: `POSTHOG_PERSON_PRIVACY_API_KEY`, a dedicated personal API
  key with only `person:write`, read at runtime on the server with
  `POSTHOG_API_HOST` and `POSTHOG_PROJECT_ID`. It isn't a build input or in
  the `feature-flags:sync` task env, so `POSTHOG_API_KEY` never gains
  `person:write`. Without the key or the project, nothing is sent and each
  request logs `posthog_person_anonymisation_unavailable`.
- A grant makes no PostHog call. PostHog removed its "reset deleted person"
  endpoint (PostHog PR #125747): ingestion revives a deleted distinct ID on
  the next identified event, so the profile re-forms on its own. The revived
  person reuses the old person row, so events kept under the same distinct ID
  may reattach to it; don't promise clean historical separation.
- Races: a deletion already in flight when the account grants again still
  deletes the re-forming profile, which re-forms on the next identified
  event. A device that hasn't loaded a signed-in page since the withdrawal
  keeps identifying until its next signed-in page load, and its events
  re-form the profile; nothing deletes it again until a later withdrawal or
  account deletion.

## Retention

PostHog `reset` changes only local identity state; it doesn't delete remote
events or unmerge aliases. Public legal copy uses generic provider-settings
language for analytics retention; don't promise deletion deadlines. How
PostHog erasure requests are handled is the project owner's decision and must
not block account deletion; account deletion only schedules the
[person anonymisation](#person-anonymisation). Better Auth retention is in
[privacy and retention](privacy-and-retention.md).

## Verification

From `apps/deskohub-workspace`, run `bun scripts/posthog-identity-browser.ts`.
It uses a local fake ingest and synthetic identities, and fails unless the
installed SDK and every event's `$lib_version` match the pinned `posthog-js`
version. CI doesn't run it, so `scripts/posthog-sdk-version.test.ts` keeps the
pin exact. Run the browser script on every SDK upgrade and check flag,
remote-configuration, capture, and replay payloads.
