# User-pattern business research

Research date: 2026-08-27

## Decision summary

Workspace sells perishable capacity. An empty desk, room, or office hour cannot be sold after it passes. The business should therefore optimize contribution per available unit-hour, not raw traffic, occupancy, or checkout conversion in isolation. Cornell describes this revenue-management problem as fixed capacity with time-variable demand and recommends pricing and availability decisions against forecast demand ([Cornell revenue management](https://ecornell.cornell.edu/certificates/hospitality-and-foodservice-management/hotel-revenue-management/)).

The live audit changes the order of work. The strongest opportunities are:

1. Cancel seven verified-empty legacy payment holds, and reconcile the provider-pending hold before cancelling it.
2. Repair analytics privacy and identity before using acquisition or retention funnels to allocate spending.
3. Improve the first reservation and the meeting-room duration control, not the card-payment step.
4. Make repeat booking faster without building an account system.
5. Measure capacity, contribution, availability loss, and field performance before pricing or inventory expansion.

External benchmarks should generate hypotheses, not targets. Baymard's 70.22% cart-abandonment average combines 50 ecommerce studies and does not describe Czech workspace booking ([Baymard abandonment aggregate](https://baymard.com/lists/cart-abandonment-rate)). Deskohub's own completed reservations and capacity are the baseline.

## Live audit baseline

The audit used aggregate, read-only production data. `dhw` was updated to 1.9.1 before collection. The authoritative reservation window is the 90 Prague-local calendar days from 2026-05-30 through 2026-08-27. The comparison period is structurally empty, and Workspace reservation history begins on 2026-06-09, so this report does not claim period-over-period growth, seasonality, lifetime value, or causality.

| Measure | Observed result | Interpretation |
| --- | ---: | --- |
| Workspace attempts | 62 | 40 paid, 14 cancelled, 8 still pending |
| Terminal paid conversion | 74.1% | 40 paid / 54 paid-or-cancelled; excludes unresolved holds |
| Payment-attempt success | 93.0% | 40 paid / 43 terminal payment attempts |
| Gross paid booking value | CZK 14,485 | AOV CZK 362.13; one CZK 245 refund leaves CZK 14,240 captured |
| Same-day demand | 66.1% of attempts | 90.3% were made within three days; median lead time was zero |
| First-observed conversion | 52.6% | 10 paid / 19 terminal attempts for a customer's first row in this database |
| Repeat-attempt conversion | 85.7% | 30 paid / 35 terminal repeat attempts |
| Repeat demand | 82.3% of attempts | 51 of 62 attempts came from customers with multiple observed rows |
| Concentration | Top five: 52.7% of gross | Strong repeat behavior with material small-sample customer concentration |
| Product mix | Meeting room: 14.1% of gross | Only two paid meeting-room bookings; useful for a cheap test, not expansion |

Gross paid booking value is a checkout proxy, not GAAP revenue or contribution. The systems do not expose taxes, payment fees, variable service cost, cash sales, or a capacity denominator. They therefore cannot yet support profitability, utilization, CAC, CAC payback, or LTV calculations.

Activity accelerated during the observed launch period: June, July, and August through the 27th produced 6, 4, and 30 paid reservations respectively, with 72.0% of observed gross value in August. This is an encouraging signal, not a seasonal or durable growth rate. Tuesday and Wednesday produced 60.1% of gross value, but without available unit-hours this is demand mix rather than utilization.

### Funnel and audience

The consented PostHog lifecycle funnel for 2026-05-29 through 2026-08-26 was 50 reservation starts, 39 payment starts, 33 payment completions, 33 reservation completions, and 33 fulfilled reservations. Eleven starts were lost before payment began and another six before payment completed. `dhw` independently shows that 11 of 14 terminal cancellations occurred before any payment attempt, while terminal payment-attempt success was 93.0%. The strongest observed leak is therefore before payment, not evidence for replacing the payment provider.

PostHog recorded 607 web visitors over 90 days, but no people joined from `$pageview` to `reservation started`. Browser events use an anonymous PostHog identity while server lifecycle events use the reservation ID. Weekly retention consequently reports zero even though `dhw` proves repeat bookings. Acquisition-to-booking conversion, paid-channel ROI, and browser retention are not currently measurable.

In the current complete 30-day PostHog window, visitors were effectively flat at 272 versus 273, while sessions rose 9.2% and views rose 52.8%. Mobile represented 70.0% of visitors. Paid Search represented 53.2% of initial-channel attribution rows, but channel rows are not mutually exclusive and cannot join to bookings. Keep paid acquisition roughly stable until channel, booking value, and contribution can be joined.

The 30-day lifecycle funnel was 48 starts to 32 fulfilled reservations, or 66.7%. The prior period had no booking events, so it is an instrumentation baseline rather than a conversion trend. Czech starts converted 18 of 23 and English starts 16 of 27; the 19-point descriptive gap is too small to justify a locale redesign. Reassess after roughly 100 starts per locale.

### Vercel traffic and reliability

Vercel Web Analytics recorded 977 current-period pageviews versus 697 in the prior period, while its daily-reset visitor count moved from 315 to 326. Pageviews per visitor-count rose from 2.21 to 3.00. Mobile produced 59.9% of pageviews and 73.9% of visitor-counts. This supports mobile-first performance measurement, but the rising depth can mean either better engagement or more navigation friction.

The Vercel browser event `workspace_checkout_started` recorded 28 current starts, versus 48 server reservation starts over the comparable period. Consent, blocking, and different event boundaries make the browser event useful for route and device diagnostics, not the authoritative business funnel.

The last seven days contained 18 application error-level log entries but no HTTP 5xx response. The production hold-cleanup cron returned HTTP 200 and its logs showed pending payment finalization and skipped unconfirmed outcomes, which agrees with the authoritative stale-hold records. There is no evidence here of a customer-facing outage.

Speed Insights has no data because the client package is not integrated. It is available separately from paid Observability, so buying Observability Plus is not required to establish Core Web Vitals ([Vercel Speed Insights](https://vercel.com/docs/speed-insights)).

## Root causes found in code

### Eight historical payment holds

All eight unresolved attempts have past service dates, are 23 to 80 days old, and remain in the local `held / payment pending / fulfillment not started` state. Seven have a fresh provider lookup with no operations, no authorized amount, and no captured amount. One has a provider authorization still marked pending and requires operator review. Three holds also contain CZK 278 of discount claims that may remain reserved until the workflow reaches a terminal state.

This is historical residue, not evidence that the current cleanup design should be replaced. Every affected attempt predates the 2026-08-06 change that persisted `providerOrderCreatedAt`. The 30-minute empty-order cleanup shipped afterward deliberately refuses to infer abandonment when that timestamp is missing. The daily recovery sweep is running and records the rows as needing review, but the administration flow cannot cancel them in their current state. No equivalent stale attempt was created after 2026-08-05.

The smallest safe repair is an explicit operator force-cancellation that reuses the existing payment lifecycle: after reviewing current provider facts, atomically cancel the local pending attempt and release its claims before cancelling the provider hold. A later settlement must require a refund instead of recreating the operator-cancelled booking. Use it for the seven verified-empty legacy orders, and only for the provider-pending order after manual reconciliation. Do not add a permanent estimated-timestamp fallback. Add an alert for a held and pending reservation past its service date.

An operator requested cancellation of all eight on 2026-08-27. The authenticated, non-interactive `dhw reservations cancel --yes` workflow was attempted for every row. It changed zero rows and rejected all eight because administration cancellation deliberately excludes `payment_state = pending`. Direct database updates would bypass payment terminalization, discount-claim release, provider cancellation, and late-payment recovery, so none were used. Completing this request requires the explicit force-cancellation described above.

### Analytics identity, privacy, and event shape

The code already stores consent-gated PostHog distinct and session cookies and makes them available to server request context, but lifecycle capture assigns the reservation ID as `distinct_id`. Link the existing anonymous identity across the browser-to-server boundary under the current consent policy, without PII. Acceptance is a non-zero pageview-to-reservation funnel and a repeat funnel that agrees directionally with authoritative bookings. PostHog's identity guidance requires a consistent distinct ID before and after identification ([PostHog identification](https://posthog.com/docs/product-analytics/identify)).

The server event service also copies arbitrary active log and span annotations into PostHog properties. In the cleanup loop this leaks a serialized internal `result` object into `reservation abandoned`. Replace ambient copying with an explicit allowlist of bounded business properties and safe trace identifiers, or at minimum scope the per-order annotation to one loop iteration. Do not send free-form errors, objects, customer input, or provider payloads.

Vercel Analytics currently receives unredacted URLs. Dynamic reservation status and access paths therefore expose opaque operational identifiers in analytics. Configure `beforeSend` to normalize dynamic segments before collection; Vercel explicitly recommends redaction or dropping events when URLs could contain sensitive identifiers ([Vercel Analytics configuration](https://vercel.com/docs/analytics/package), [Vercel privacy guidance](https://vercel.com/docs/analytics/privacy-policy)).

### Observed interface friction

PostHog's desktop rage-click data does not implicate payment checkout: the pay route recorded zero desktop rage events. The meeting-room route recorded 25 rage-click events across only three sessions on 2026-08-12 and 2026-08-13. Nineteen events targeted the four-hour duration option, but the sessions were unusually repetitive: they produced 3, 8, and 14 rage events and 42, 114, and 160 ordinary autocapture events. None reached `workspace_checkout_started` or emitted an exception.

This cluster belongs to a fixed deployment. An accessibility change deployed before the first cluster temporarily broke whole-card duration selection. The `fix-duration-option-selection` deployment reached production at 2026-08-13 11:55 UTC, after the last clustered session. PostHog recorded zero desktop meeting-room rage clicks from that deployment through 2026-08-27. A live production trace on 2026-08-27 showed the current four-hour option changing checked and selected styles within about 17 milliseconds. Its availability request returned HTTP 200 in about 1.2 seconds, with no console or page error. Do not change this control again from the historical rage-click aggregate.

The home photo carousel produced 9 of 11 home rage events. Rapid carousel clicks can be intended interaction, so ignore this unless manual reproduction finds lost or delayed input. Current exceptions are dominated by generic `Script Error`, which should be normalized or sampled before it can guide product work.

## Acquisition-to-booking identity design

Use the consented browser-generated PostHog distinct ID as the booking funnel identity. Do not use the reservation ID, email, phone, or Dotypos customer ID, and do not mint another backend ID. Workspace has no authenticated account boundary, so entering contact details is not proof that the browser belongs to a particular person. Do not call `identify` or `alias` during checkout. PostHog's documented unauthenticated flow is to pass `posthog.get_distinct_id()` to the backend and capture server events with that exact ID; backend SDKs do not otherwise share the browser's anonymous session ([PostHog browser-to-backend identity](https://posthog.com/docs/product-analytics/identify#carried-to-the-backend), [PostHog identity resolution](https://posthog.com/docs/product-analytics/identity-resolution#passing-the-id-across-environment-transitions)). This design measures a consented browser or device, not a known customer or cross-device retention. Keep `dhw` and Dotypos as the authoritative customer-repeat view.

The event sequence should be:

1. Before analytics consent, capture nothing and persist no analytics identity. After consent, keep PostHog's anonymous distinct ID and session ID. The existing client already mirrors both to first-party cookies and sends PostHog tracing headers. Those headers are untrusted analytics context, never authentication or authorization.
2. On `preparePayState`, parse the IDs only through the existing consent-gated request-context function. Store nullable `posthogDistinctId` and `posthogSessionId` on the first reservation draft. An idempotent retry must keep the stored values rather than replace them with a later request; a superseding reservation must copy them from the original attempt.
3. Emit `reservation started` and subsequent payment, abandonment, completion, and fulfillment events with the persisted distinct ID. Include the reservation ID only as an event property and in the existing deterministic event UUID. This lets a webhook, recovery sweep, or cron event retain acquisition identity after the browser request has ended.
4. Mark lifecycle events using an anonymous browser ID with `$process_person_profile: false`. PostHog's browser `person_profiles: "identified_only"` setting does not carry into Node; server SDK events are identified by default unless this event property is set ([PostHog anonymous and identified events](https://posthog.com/docs/data/anonymous-vs-identified-events#how-anonymous-and-identified-events-work)).
5. Add the persisted session as `$session_id` only while the event genuinely belongs to that browser session. PostHog does not add sessions to server events automatically and recommends reusing the frontend session for a backend purchase confirmation ([PostHog server SDK sessions](https://posthog.com/docs/data/sessions#server-sdks-and-sessions)). A valid custom session ID is UUIDv7, belongs to one user and session, and covers no more than 24 hours. Omit `$session_id` from later webhook or cron events outside that window; the distinct ID still supports the person funnel, but the event must not be reported as part of the original session ([PostHog custom-session constraints](https://posthog.com/docs/data/sessions#custom-session-ids)).
6. Use PostHog's computed session entry fields for channel analysis, including entry URL, referrer, UTM values, and channel type. Do not copy full URLs, query strings, or UTM values into every lifecycle event. The valid `$session_id` is the join to those session properties ([PostHog session properties](https://posthog.com/docs/data/sessions#session-properties)).

Consent withdrawal needs an explicit product-policy decision. The current browser path disables tracing, opts out, resets the browser identity, and clears the mirrored cookies; the server parser also rejects IDs without a current analytics-consent cookie. PostHog opt-out state is local to the browser, however, and its server SDK is stateless per call, so withdrawal does not automatically stop a webhook or cron job from using an ID already stored on a reservation ([PostHog consent management](https://posthog.com/docs/privacy/data-collection#using-posthog-with-a-consent-management-platform-cmp), [PostHog SDK opt-out specification](https://github.com/PostHog/sdk-specs/blob/main/openspec/specs/is-opt-out/spec.md)). If withdrawal must stop all later joined lifecycle analytics, send the old in-memory anonymous ID to a withdrawal-only server action before resetting it, then durably suppress that ID or mark matching reservations with `analyticsConsentRevokedAt`. This action cannot use the normal consent-gated parser because the consent cookie has already changed. If operational lifecycle events have another reviewed lawful basis, emit them under the reservation ID with `$process_person_profile: false` and `acquisition_attributed: false`; do not silently join them. Also change the browser withdrawal order to reset first and opt out last, because PostHog documents that reset clears persisted opt-out state ([PostHog reset](https://posthog.com/docs/references/posthog-js#reset)). Neither reset nor opt-out deletes previously ingested data. Initialization can remain deferred until consent; if the SDK is ever initialized earlier, set `opt_out_capturing_by_default: true` and retain the `before_send` consent check as defense in depth.

Implementation would touch these code boundaries; line numbers describe the audited revision:

- `features/cookie-consent/components/posthog-analytics.tsx:83-162`: keep cookie and tracing-header synchronization and correct reset/opt-out ordering. If the strict delayed-event policy is selected, start the withdrawal handshake from `features/cookie-consent/components/cookie-consent-provider.tsx:48-76` before the consent update clears the old analytics context. `shared/utils/posthog-session-cookies.ts:7-59` already defines the two cookies and needs no change for the basic join.
- `packages/posthog/src/identifiers.ts:11-26`: bound the distinct-ID transport value and validate the session ID as the browser-generated UUIDv7 shape. `shared/backend/analytics/posthog-request-context.ts:17-99` remains the sole consent-gated parser. `shared/backend/workspace-action.ts:52-66,142-166` must expose its parsed result explicitly to the action handler instead of relying on ambient log annotations.
- `db/schema/workspace-reservations.ts:76-128` plus a database migration: add nullable, bounded PostHog distinct and session IDs and, if required by policy, withdrawal state. Treat this link to a reservation as pseudonymous personal data with an explicit retention and access policy.
- `features/reservation/backend/workspace-reservation.repository.ts:68-76,301-361,747-797`: write attribution only on the first insert, preserve it on idempotent conflict, and copy it during supersession. `features/reservation/actions/prepare-pay-state.ts:658-767,986-992,1047-1055` must pass the action context into draft creation and lifecycle capture.
- `features/checkout/backend/analytics/posthog-lifecycle-events.ts:41-183`: choose the persisted browser ID when present, keep reservation IDs as properties and event-deduplication inputs, set `$process_person_profile`, and validate or omit `$session_id`. `shared/backend/analytics/posthog-event.service.ts:18-24,65-127` must accept only explicit analytics properties rather than sourcing identity or customer data from ambient annotations.
- Lifecycle callers that run after the browser request must load or carry the reservation attribution: `checkout.service.ts:504,653,691`, `payment/nexi-webhook.service.ts:529,578,590`, `payment/provider-payment-finalization.service.ts:284,352,364`, `holds/reservation-hold-cleanup.service.ts:326`, `fulfillment/paid-fulfillment.service.ts:329`, and `fulfillment/resend-webhook.service.ts:355`.

Acceptance tests must prove the boundary rather than assert production identifiers:

- With analytics denied, tracing headers and stale custom cookies produce no attribution, no attribution is persisted, and no lifecycle event joins a browser identity.
- Malformed or overlong client-supplied IDs are rejected. They never authorize a request, select a reservation, or expose data.
- With analytics accepted, a synthetic page event, `reservation started`, and synchronous payment confirmation use one synthetic distinct ID; server events set `$process_person_profile: false`, carry the expected reservation property, and use the same valid session ID.
- Webhook and cron tests run without request headers and recover the persisted distinct ID. Events within the valid session window carry `$session_id`; delayed events outside it do not.
- Retrying the same checkout does not overwrite first-touch attribution. A superseding draft copies it. Withdrawing and then consenting again creates a new anonymous ID and never aliases it to the old one.
- Event properties contain no email, phone, name, customer ID, access code, raw URL, query string, provider payload, or free-form error object.
- Test the paths in `posthog-analytics.test.tsx`, a new `posthog-request-context.test.ts`, `workspace-reservation.repository.test.ts`, `prepare-pay-state.test.ts`, `posthog-lifecycle-events.test.ts`, and `posthog-event.service.test.ts` with synthetic UUIDs only.

Set a clean reporting cutoff at release. Existing reservation-ID lifecycle events cannot be deterministically mapped to browser IDs because the mapping was never stored, and identity merging cannot reconstruct a missing session ID. Do not alias or backfill old reservation IDs: alias is an advanced merge operation with uniqueness constraints, affects person-level identity resolution, and does not rewrite raw event distinct IDs ([PostHog alias constraints](https://posthog.com/docs/product-analytics/identify#alias-assigning-multiple-distinct-ids-to-the-same-user)). Historical raw SQL must account for sibling distinct IDs after any legitimate future identification, while feature-flag assignments and missing session attribution are not repaired retroactively. If authenticated accounts are later introduced, call `identify` only after authentication with one stable, opaque, non-PII account ID, use that exact ID on the server, and reset on logout.

## Recommended order of work

1. **Protect inventory and customer state now.** Force-cancel the seven verified-empty legacy holds through the existing lifecycle, reconcile and then cancel the provider-pending hold, release any stranded discount claims, and alert on future past-service pending holds.
2. **Make measurement safe and joinable.** Normalize dynamic Vercel URLs, allowlist PostHog event properties, carry the consented anonymous identity into server lifecycle events, and add bounded events for availability outcome and pre-payment failure category. The existing revenue property only began on 2026-08-19; let it accumulate rather than rebuilding it.
3. **Measure first-use loss, not the whole checkout.** First-observed terminal conversion was 52.6% versus 85.7% for repeats. The historical duration-control problem is already fixed. Instrument one checkout-step outcome with bounded enums and preserve valid input after failures. Do not remove fields or add payment methods until event evidence identifies the cause.
4. **Ship the smallest repeat-booking feature.** The status page's current “start new reservation” action preserves only the product family. Prefill the previous product shape from a fulfilled reservation and revalidate availability, price, discounts, and terms. Add a post-use email only if consent and unsubscribe behavior are already supported. An account system is not yet justified.
5. **Measure economics before incentives.** Add available unit-hours and variable cost to the operating scorecard. Use existing discount fencing only for measurably weak capacity; repeat customers already convert well, so blanket retention discounts are likely to give away margin.
6. **Run two cheap experiments after measurement works.** Test clearer meeting-room discovery because two paid bookings generated CZK 2,040, but do not expand capacity from two observations. Test unavailable-slot alternatives only after `available`, `unavailable`, and `alternative selected` events prove meaningful recoverable demand.
7. **Add field performance data.** Integrate Vercel Speed Insights behind the existing analytics-consent boundary. Optimize only routes whose mobile 75th-percentile Core Web Vitals are poor and commercially material.

The operational repair, privacy normalization, and property allowlist are fixes. The repeat-booking shortcut, meeting-room discovery, and unavailable alternatives remain hypotheses until an observed metric or controlled test validates them.

## Measurement contract

Use each system for the facts it can support:

- `dhw` and the reservation, payment, discount, and sales records are the source of truth for booking states, checkout value, refunds, cancellations, discount claims, and observed repeat customers. Capacity, costs, taxes, and accounting revenue require additional operating and finance data.
- PostHog is the source for consented sessions, paths, funnel friction, and experiments. Its funnel guidance recommends starting with mandatory steps and excluding optional steps that would skew conversion ([PostHog funnels](https://posthog.com/docs/product-analytics/funnels)).
- Vercel Web Analytics is the source for anonymous page traffic, route mix, referrers, device, and geography. Its visitor hash resets daily, so a Vercel visitor is not a returning customer and cannot support retention analysis ([Vercel Web Analytics](https://vercel.com/docs/analytics)).
- Field Core Web Vitals should use the 75th percentile separately for mobile and desktop. The current "good" thresholds are LCP at or below 2.5 seconds, INP at or below 200 milliseconds, and CLS at or below 0.1 ([Chrome threshold methodology](https://web.dev/articles/defining-core-web-vitals-thresholds)).

The current code already emits durable server-side lifecycle events for `reservation started`, `reservation abandoned`, `reservation completed`, `reservation fulfilled`, `payment started`, `payment completed`, `payment abandoned`, and `payment failed`. Payment events include checkout value, currency, provider, and failure details, although free-form failure and ambient context properties should be bounded before relying on them. The browser emits `workspace_checkout_started` only after `preparePayState` succeeds and only with analytics consent.

Those two streams do not currently form one person funnel. Browser events use PostHog's anonymous identity, while server lifecycle events use the Workspace reservation ID as `distinct_id`. PostHog requires a stable linked identity to follow one person across sessions and devices ([PostHog identification](https://posthog.com/docs/product-analytics/identify)). Do not report page-view-to-completion as a user funnel until the identities are deliberately linked or the events are joined by a non-person reservation key. Keep PII out of analytics. A customer-stable identifier is justified only with a reviewed privacy and consent design.

Use these business measures:

- Contribution per available unit-hour: completed reservation revenue minus discounts, payment fees, refunds, and variable servicing cost, divided by sellable desk, room, or office hours.
- Availability conversion: qualified availability result to prepared checkout, then prepared checkout to completed reservation.
- Payment completion: `payment completed` divided by `payment started`, split by provider, device, amount band, and failure code.
- Fulfillment completion: `reservation fulfilled` divided by `reservation completed`.
- Repeat purchase: share of first-time completed customers with a second completed reservation within 30, 60, and 90 days.
- Discount incrementality: contribution and available-unit utilization for eligible inventory against comparable undiscounted inventory, including the weeks after the promotion.

Do not mix zero-price completions with paid-payment conversion. Do not count abandoned holds as lost demand until their availability, price, and customer intent are known. Hide incomplete funnel periods so late payments and active holds do not make the newest cohort look artificially weak.

## Product and operating opportunities

### Recover unavailable demand

The reservation UI checks current availability and disables submission when the selected capacity is unavailable. That protects inventory, but the next commercial step is a recovery choice. Show the nearest valid dates or times and preserve the customer's product, duration, and seat count.

Baymard's closest published analogue is moderated tours-and-experiences booking research. Users lost patience when they had to open dates one at a time to discover availability. They also needed price, duration, start time, location, restrictions, and cancellation policy before committing ([Baymard tours and experiences](https://baymard.com/blog/tours-and-experiences-launch)). This is qualitative travel research, not a forecast of conversion lift.

First measure `availability checked`, `available`, `unavailable`, and `alternative selected`, with product family, requested slot, lead time, and capacity. Then add alternatives only where unavailable searches are material.

### Remove proven checkout friction

Workspace already avoids forced account creation and delays conditional invoice fields until the customer requests an invoice or books for a business. Keep that shape. The required customer fields are name, email, and phone, followed by a separate summary and legal acceptance before payment.

Baymard's US survey reports that 17% of respondents had abandoned an order in the prior three months because checkout felt too long or complex, 17% because of errors, and 19% because they did not trust the site with card information ([Baymard checkout study](https://baymard.com/blog/ecommerce-checkout-usability-report-and-benchmark)). These are recalled retail reasons, not observed Deskohub causes.

Instrument the actual Deskohub causes before removing fields: validation category, availability rejection, price refresh, transport failure, `pricing_changed`, discount rejection, payment failure code, and retry success. Never capture entered field values. The first likely fixes are clearer inline recovery, preserving valid input after failures, and explaining why a phone number is required. Remove a field only if operations do not need it.

### Earn the second reservation

Use fulfilled reservations linked to the same Dotypos customer to build first-purchase monthly cohorts. PostHog retention also requires a start and return event performed by the same identity and distinguishes first-time from recurring retention ([PostHog retention](https://posthog.com/docs/product-analytics/retention)). Current reservation-ID identities cannot answer that question by themselves, while `dhw` can group authoritative bookings by customer.

A customer-lifetime-value model fitted to public data from five firms estimated that a 1% improvement in retention increased modeled firm value by 5%, compared with 1% for margin and 0.1% for acquisition cost ([Gupta, Lehmann, and Stuart](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=459595)). The model fit only three of the five firms, so this is directional economics rather than a Deskohub forecast.

Test a "book again" action on the completion page and in a post-use email. Prefill the prior product and booking shape, but recheck availability, current price, discounts, and legal terms. This is more useful than an account system unless repeat-booking evidence later shows that saved profiles or team administration would pay for their complexity.

Measure second completed reservation, days to second reservation, contribution, unsubscribe rate, and whether the repeat booking displaced a full-price customer in a constrained slot.

### Fence discounts around weak capacity

Workspace already supports scheduled sales, customer-restricted codes, use limits, product eligibility, and vouchers. That is enough machinery. Use it to test off-peak periods, first visits, lapsed customers, and capacity that is predictably hard to sell.

A randomized Alibaba experiment covering more than 100 million customers and 11,000 retailers found large short-term sales effects from cart discounts, followed by more browsing and buying but lower paid prices and behavior consistent with waiting for future offers ([original field experiment](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3029707)). The market and product differ sharply from Workspace, but the economic warning transfers: blanket coupons can train customers to expect a lower reference price.

Judge a promotion on incremental contribution and retained customers, not redemptions. Compare eligible periods with similar non-promoted periods or run a controlled holdout. Stop promotions that shift existing demand, fill already-constrained slots, or reduce later full-price purchase.

### Treat payment and trust as local questions

The current flow shows the full summary before legal acceptance and preserves changed prices for renewed acceptance. Those are good trust controls. Keep payment security with the provider and do not imitate trust with decorative badges.

Stripe's 2025 holdback experiment found that dynamically showing at least one additional relevant payment method increased conversion by 7.4% and revenue by 12% on average across its eligible checkouts ([Stripe payment-method experiment](https://stripe.com/blog/testing-the-conversion-impact-of-50-plus-global-payment-methods)). That result comes from Stripe merchants and does not establish demand for a specific method in Czech workspace bookings.

Before adding a payment method, split payment starts, failures, abandonments, and mobile share by amount and customer country. Add one locally relevant method only when the lost contribution plausibly exceeds integration and operating cost, then test it with payment completion as the primary metric and refunds and fees as guardrails.

### Make field performance a booking metric

A Google-commissioned Deloitte study of 37 brand sites and 30 million sessions associated a 0.1-second mobile speed improvement with 8.4% higher retail conversion and 10.1% higher travel conversion ([Deloitte study](https://www.deloitte.com/ie/en/services/consulting/research/milliseconds-make-millions.html)). The study was observational, used supplied data, and warns against transferring aggregate vertical results to one site.

Use the research to justify measurement, not an uplift promise. Monitor field LCP, INP, and CLS for landing, cowork, meeting-room, office, checkout, and status routes. Split mobile and desktop. Compare route and device performance periods with prepared-checkout and payment completion, then prioritize only routes with both poor field performance and commercial volume. Use a controlled performance change before claiming causality. The application currently includes Vercel Web Analytics, but no Speed Insights client integration is present in the Workspace package.

## Experiment and interpretation rules

- Predeclare one primary business metric, a minimum runtime that spans weekday and weekend demand, and guardrails for contribution, refunds, cancellations, and fulfillment. PostHog tests metrics independently without correcting for multiple comparisons. At its default 95% threshold, five unrelated metrics create about a 23% chance that at least one looks positive by chance ([PostHog Bayesian statistics](https://posthog.com/docs/experiments/statistics-bayesian#multiple-metrics-and-false-positives)).
- Segment by product family, Prague weekday and time, booking lead time, mobile or desktop, first or repeat customer, acquisition channel, discount, and payment provider. Avoid small slices that turn noise into a story.
- Compare cohorts from the same stage. A reservation-page visitor, a valid availability result, a held reservation, and a payment start have different intent.
- Treat PostHog paths and correlations as ways to find a hypothesis. Use a controlled experiment or a clear operational change with a stable comparison period before claiming causality.
- Keep consent coverage visible beside every browser-derived rate. Vercel Analytics is also rendered only after analytics consent in the current application, so its traffic is a consented sample rather than total requests.
- Annotate outages, sales, holidays, inventory closures, and tracking changes. PostHog explicitly warns that weekends and sales can move funnel rates without a product change ([PostHog funnel seasonality](https://posthog.com/docs/product-analytics/funnels#understand-seasonality-in-your-conversion-rates)).

The first decision should be small: establish the scorecard and failure taxonomy, then choose the largest evidenced leak. Do not build loyalty accounts, blanket discounts, new payment integrations, or a recommendation engine before the current data shows which one can return more contribution than it costs.
