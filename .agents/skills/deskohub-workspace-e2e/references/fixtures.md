# Workspace E2E fixtures and synthetic data

## Contents

- [Synthetic recipients and email](#synthetic-recipients-and-email)
- [Magic-link retrieval](#magic-link-retrieval)
- [Account lane](#account-lane)
- [Discount fixtures](#discount-fixtures)
- [Calendar sale event](#calendar-sale-event)
- [Administrator sessions](#administrator-sessions)
- [Access-code idempotency](#access-code-idempotency)
- [Email campaign recipient preview](#email-campaign-recipient-preview)

Every case uses a unique synthetic customer. Never make an edge case mutate a fixture another case reads.

## Synthetic recipients and email

- Build every recipient with `testEmailAddress` from `@deskohub/test-email`; E2E accounts look like `delivered+<run>-<label>@<EMAIL_TEST_DOMAIN>`. Mail to `EMAIL_TEST_DOMAIN` (`deskohub.test`, a code constant) goes to the Console provider in every deployment, so there's nothing to configure. A fixture that submits any other address sends real mail. [Test email addresses](../../deskohub-repository/references/testing-and-ci.md#test-email-addresses) covers the literal-address scanner.
- Staff copies (contact, checkout, invoice) follow the triggering customer: a test-domain origin addresses `workspace-internal@<EMAIL_TEST_DOMAIN>`. Outside production, staff subjects carry `[TESTING]` (`staffEmailSubject` in `@deskohub/email`).
- Check email body content with the fake transport renderer, and delivery through Vercel runtime or webhook evidence.

## Magic-link retrieval

- On a preview, the account feature logs one `account.magic-link.preview-e2e` line after Console accepts a link for a synthetic E2E recipient. Its `{code, recipient, message, text}` envelope is the parser's wire format. Under local `next dev` it prints `account.magic-link.development` instead.
- `e2e/account/vercel-log-retrieval.ts` reads that line from `https://vercel.com/api/logs/request-logs`, the internal request-log route the Vercel CLI uses, not a documented public API. Keep every filter: project, immutable deployment, time window, marker, baseline row IDs, and exact recipient. Anything other than exactly one match is a failure.
- `WORKSPACE_E2E_VERCEL_TOKEN` is opaque to the runner and sent only as a Bearer header. The current credential is a team token with history read; prefer a narrower project credential if the route accepts one, and never require a full-account key.
- Deployment resolution, history polling, and the baseline listing are read-only, so they retry transport failures, per-request timeouts, and HTTP 408, 429, 500, 502, 503, and 504 at the poll interval, inside the existing auth-delivery and provider-transition deadlines. Other statuses, malformed payloads, and ambiguous matches are terminal. A deadline-clipped request after history already answered reports `auth_delivery_message_not_observed`.
- Redact the link from runner output and artifacts. Require an exact-preview E2E pass before you treat a delivered link as verified.

## Account lane

Account cases run serially in `account-auth` from the catalog in `e2e/account/catalog.ts`. Cases use reservation fixtures 120 days out, outside the checkout date range.

- Every case shares the runner's egress IP, so the lane gets one Better Auth magic-link rate window per path. `makeMagicLinkRateBudget` (`e2e/account/rate-budget.ts`) allows one operation fewer than the deployed limit per window. An over-budget link waits out the whole quiet window (`accountCase` in `e2e/timeouts.ts` budgets for one).
- Declare each case's sends and verifications in `workspaceE2EAccountMagicLinkLedger`. `catalog.test.ts` replays the ledger through the real budget, and `cases.test.ts` runs every case through `makeWorkspaceE2EAccountCases` with a fake boundary and checks each spends exactly its entry. Extend that fake when a case gains a new browser or fixture interaction.
- Fit a new link into the ledger by reusing the lane's signed-in session or a link it already spends. A different synthetic identity doesn't change the limiter key. Keep the replayed-link verification the account skill requires.
- The lane reads the preview's `login_email_code` flag from the UI: `account-sign-in-form` records whether the accepted card is the inbox notice or the code step, and every link journey works with either. `account-sign-in-code` enters the second unknown email's code (`retrieveSignInEmail`) and is skipped with a reason when the flag is off. To cover it, set a branch-scoped Preview `POSTHOG_FEATURE_FLAG_OVERRIDES` with `login_email_code:true` plus every flag the run needs, before the preview builds ([preview workflow](preview-workflow.md)); never change the shared Preview value.
- Keep the callback screenshot review on `account-magic-link-delivery`, which consumes the first main-recipient link inside the callback handoff. The handoff hold and its loading-document receipt run on every pass.
- Never fabricate production auth, clear rate limits, change Resend configuration, or change production limits or headroom to speed up the lane.
- On a failed CI run, `e2e:account-state` prints one token (`missing`, `unlinked`, `linked`) classifying the synthetic main account.

## Discount fixtures

`checkout-setup` upserts source-neutral discount definitions, targets, promotion-code registry rows, discount codes, and vouchers into the exact preview database (`e2e/integrations/discount-fixtures.ts`). It never inserts applications or claim history; only the deployed checkout lifecycle creates those. Capacity limits advance from retained audit history on reruns, and the suite never deletes application or redemption records.

- Write each fixture table with one multi-row statement inside the seed transaction, parents before children: the promotion-code customer sync triggers read `discount_codes`.
- Read earlier runs' active capacity uses and voucher credit inside that transaction, so every rerun on a reused preview database still gets one capacity use and one run's credit.
- `discount-fixtures.test.ts` records and pins the statement sequence; `discount-fixtures.postgres.test.ts` pins the rows and the rerun drift repair.

- Dedicated immutable code rows cover valid and customer-ineligible submissions; an unknown code needs no row. Inactive, not-started, expired, and product-ineligible codes show the same generic error, so their reason classification stays in `features/discounts/promotion-code-provider.service.test.ts`.
- Capacity and one-redemption-per-customer cases first complete a real zero-total checkout, then try the consumed code.
- The voucher case issues credit for two zero-total reservations, spends it twice, checks two `voucher_redemptions` rows totaling the issued credit, and then expects the unavailable error. Its fixture derives issued credit from earlier applications so reruns keep audit history.
- Customer fixtures come from the normal Dotypos customer API. The runner picks an active partial-percentage group, derives the expected discount from its real percentage, and assigns customers with an ETag-protected patch. Cases change only their own customer's group, never the group definition.

Browser E2E proves customer-visible behavior and the persisted lifecycle state:

| Scenario | Browser evidence |
| --- | --- |
| Calendar sale alone, with a code, or with a customer discount and a code | Completed payment, generic label, applications persisted in source-neutral order |
| Code brings the total to zero | Internal paid attempt, redeemed claim, fulfillment, no Nexi page |
| Voucher partly spent, reused, exhausted | Two internal paid attempts, two claims totaling the credit, then the unavailable error |
| Unknown or customer-ineligible code | One generic field error; summary still usable; no payment state, application, or claim |
| Capacity exhausted or already redeemed | A real first redemption, then the rejected attempt |
| Code, Calendar sale, or customer discount changes after summary, before Pay | `pricing_changed`; no payment attempt, application, or claim |
| Calendar sale disappears after advertisement, before quote | Refreshed summary with `pricing_changed` |

Keep malformed input, provider failures, clock boundaries, cache expiry, and claim races in deterministic provider and checkout lifecycle tests. Calendar all-day expiry follows the selected date, so browser cases can't wait for real Prague midnight; provider tests use Effect's test clock for the exclusive end.

## Calendar sale event

`GOOGLE_CALENDAR_SALES_ID` names the dedicated E2E sales calendar. Its long-lived event references the discount definition seeded with UUID `454784dd-380b-43a1-bae7-cc070bf1aec2`, which targets the open-space and reserved-desk cowork tiers separately, plus the meeting-room family.

- Keep the event immutable and non-recurring. It must start on or before the run date and end after the 90-day candidate range. A sale applies only to bookings made during it whose last service date falls within it, so a daily recurring event would cover only same-day bookings.
- Happy paths book open space. Only the pricing-change case books a reserved desk, and it runs in the ordinary `checkout-cases` pool. It advertises both of its checkouts first (the payment-change checkout up to its captured pay page), then removes only the reserved-desk target once, and restores it in an interruption-safe finalizer. Both scenarios must show the normal `pricing_changed` state with no payment attempt. Never mutate the open-space or meeting-room targets.
- Fixture writes skip the admin mutation's tag revalidation, and Calendar discovery caches the whole resolved definition under the booking date (today) and deployment through `use cache: remote`. An entry filled during the removal window, or served for up to one `advertisedPricingSources` revalidation after the restore, lacks only the reserved-desk target, so it still advertises the sale to every open-space and meeting-room checkout. Quote and payment revalidation read the definition straight from Postgres. Only reserved-desk advertising can go stale, and only this case reads it.
- A family-wide target mutation would leak that stale state into every concurrent case of the family. Keep reserved desk out of every other case's checkout, or give a new mutation its own tier.
- Bring every checkout that needs the advertised sale to that state before the single eligibility removal. Never wait for a restored row to show through the cache, which costs a full revalidation cycle. Keep the reload-until-advertised poll only as a safety net for a stale entry, such as one a retry of this case meets.

## Administrator sessions

Admin pages accept only a verified Better Auth session whose account holds an `account_role_grants` `administrator` row. A signed-out page load redirects (307) to `/<locale>/auth/sign-in?returnTo=<path and query>`; a signed-in account without the grant gets the ordinary 404.

- Admin cases sign in as a seeded synthetic administrator, never by magic link: `makeWorkspaceE2EAdministrationIdentities` (`e2e/administrators/identities.ts`) journals the account under the case's owner, then `seedWorkspaceE2ESyntheticAccount` inserts the verified user and its `roles` grants in one transaction, and `signIn` issues a short-lived session and adds the signed cookie to the case's Playwright context (`signInWorkspaceE2ESyntheticBrowserContext`, preview origin only). The signing secret is the same `WORKSPACE_E2E_BETTER_AUTH_SECRETS` the [seeded sessions](referral-lane.md#seeded-sessions) use, so admin cases fail closed without it.
- Each case owns a closed set of recipient labels in `workspaceE2EAdministrationRecipientLabels`; `checkout-cleanup` reconciles those journals with the others. Deleting the user cascades its sessions and grant. Seed the administrator only after the bypass is primed, right before the first admin page.
- Grant nothing to an account a case didn't seed, and never copy a real administrator into a preview. Production-derived preview branches may hold inherited grants; E2E never reads or relies on them.
- `create-access-code` asserts every attempt event names the seeded account (`actor_account_id`, `actor_account_email`).

## Access-code idempotency

Reset or "Create another" mints a new attempt ID, so it proves nothing about idempotency. Replay the first submission's captured Server Action POST byte for byte (same `Next-Action` ID, content type, origin, and payload) through the context request API. Assert the `already-created` outcome, that the one-time PIN isn't disclosed again, and the attempt-event counts in the preview database. Clean only exact synthetic rows, pre-clean for reruns, and prove zero matching rows remain in an interruption-safe finalizer.

## Email campaign recipient preview

Audience tag conditions read Dotypos profile tags, and marketing campaigns reach only customers with an active `customer_marketing_consents` row. The case creates one synthetic Dotypos profile with a per-run tag and a Czech consent row, builds the audience and draft through the admin UI, and expects that profile to be the only recipient in the preview. It never test-sends or sends. Each submit retains the next Server Action request with no request timeout. Its finalizer first closes the admin browser context, so no late request can leave the browser and an unsent submission settles as undispatched, then waits on both Server Action barriers, deletes the run's campaign, audience, and consent rows by exact title and customer, proves none remain, and clears the profile's tags while expiring it (profiles are never deleted).
