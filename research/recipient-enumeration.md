# Admin email campaigns: recipient enumeration and audience filters

Research for the admin email-campaign feature. Base: `origin/main` at `817f1e9d5`. Sources are repository code (paths relative to the repo root; `apps/deskohub-workspace` is shortened to `ws/`) and the official Dotypos API docs (docs.api.dotypos.com). No production data or live Dotypos API was queried.

## Recommendation in one paragraph

Enumerate from **local Postgres**, not from Dotypos. The candidate universe is the set of Dotypos customer IDs Workspace already knows (reservations ∪ account links ∪ marketing consents), narrowed to active consents for marketing campaigns. Evaluate local predicates in SQL first. Then hydrate the surviving IDs from Dotypos with the existing `getCustomers({ ids })` (ID-chunked `id|in` filter, 100 per page) and evaluate the tag and discount-group leaves in memory. Use the Dotypos profile email (never the Better Auth login email). Use one locale resolver shared with rendering (account → reservation → consent → `cs`). Freeze customer IDs and locales, not emails, because the schema forbids email columns. A Dotypos failure fails the resolution as a whole: there are no partial lists.

## 1. Dotypos customer API

| Fact | Source |
| --- | --- |
| `GET /clouds/{cloudId}/customers` lists customers and `GET …/customers/{customerId}` returns one. | `packages/dotypos/openapi/dotypos-api.yaml:357-382` |
| Customer fields include `id`, `_discountGroupId`, names, `email`, `tags` (string array or null), `deleted`, `display`, `flags`, `versionDate`. There is **no locale/language field**. | `dotypos-api.yaml:1668-1802` (tags `:1780-1786`); docs `entity/customer/` |
| Service methods: `getCustomers({ ids })`, `getCustomer`, `searchCustomers`, `findCustomer`. There is **no unfiltered list method**: `getCustomers` requires IDs. | `packages/dotypos/src/backend/service.ts:68-70, 912-950, 1797-1809` |
| `getCustomers` builds `id|in|<ids>;deleted|in|0,1`, so **it returns deleted customers too**. It pages with `limit: 100` until `nextPage` is null, and treats a 404 on page 1 as empty. | `service.ts:915-940`, pager `service.ts:215-242` |
| Paging: `limit` defaults to 20 and is capped at 100. The envelope has `totalItemsCount`/`lastPage`, which may be null for some entities. | docs `api-reference/general/paging/`; `dotypos-api.yaml:1432-1447, 1615-1666` |
| Filter syntax is `attr|op|value;attr|op|value`. Semicolon-joined conditions combine with AND, as the documented range examples imply (no OR). Operators: `eq ne gt gteq lt lteq like in notin bin bex`. | docs `api-reference/general/filter/` |
| Server-side filterable customer fields: `id`, `_discountGroupId`, `tags` (EQUALS/ENUM), `versionDate`/`created` (NUMBER), and `email` with STRING (`like`) only. | docs `entity/customer/`; skill `deskohub-dotypos` "Customer records" |
| `DiscountGroup` list/get endpoints are modelled. The repo has no Tag endpoint, though Dotypos documents `GET /tags`. | `dotypos-api.yaml:1348-1410, 1804-1848`; docs `entity/tag/` |
| Rate limits: the docs list only `429 Too Many Requests`, with no quota numbers and no `Retry-After` contract. The service retries 429, 5xx, and network errors with jittered exponential backoff from 100 ms, at most 3 retries. The per-request timeout is 30 s, and service construction applies `Effect.withConcurrency(5)`. | docs `api-reference/general/common-error-responses/`; `service.ts:82-129, 1816-1819`; `packages/dotypos/src/api-timeout.ts:1-3` |
| Customer count: no figure in the repo or skills. `/admin/customers` in production would give the Workspace-known count, but it was not queried. | searched `.agents/skills`, `apps/`, `packages/` |

The docs leave the semantics of `tags|in|a,b` on an array field (any-of?) unconfirmed. Verify it against the E2E cloud before relying on server-side tag pushdown. The recommended design does not need it.

## 2. Filters: authoritative source and evaluation

| Filter | Authoritative source | Strategy |
| --- | --- | --- |
| Active marketing consent (implicit for marketing) | `customer_marketing_consents`: PK is the Dotypos ID; `locale`, `granted_at`, `withdrawn_at` (`ws/db/schema/customer-marketing-consents.ts:11-36`). Active means `withdrawnAt === null` (`ws/features/legal/marketing-preferences.ts:33-38`). | SQL. Becomes the **universe** for marketing campaigns. Re-check at delivery time so a withdrawal between freeze and send wins. |
| Has a Workspace account | `customer_account_links`: one-to-one user ↔ unique `dotypos_customer_id`, with no unlink status; deleting the user cascades (`ws/db/schema/customer-account-links.ts:6-24`). | SQL semi-join. |
| Reservation state | `workspace_reservations.reservation_state` / `payment_state` / `fulfillment_state` (`ws/db/schema/workspace-reservations.ts:37-47, 98-112`). | SQL. Reuse the admin status vocabulary and `statusCondition` (`ws/features/administration/administration.service.ts:898-930`; values `complete`, `cancelled`, `needs_refund`). Don't expose raw state machines to admins. |
| Reservation in a date range | **Booking dates are not stored locally.** Details are "persisted without provider-owned facts" (`ws/features/reservation/persistence-contracts.ts:22-24`). Start/end come from Dotypos (`ws/features/reservation/backend/workspace-reservation.service.ts:152-156, 302-305`). There are local lifecycle instants (`reservation_created_at`, `reservation_confirmed_at`, `paid_at`, …, `:124-136`) but no date index. | Decision needed: (a) **occupancy date**: call `dotypos.listReservations(range)`, then join local rows on `dotypos_reservation_id`. This is exactly what admin `listReservations` does (`administration.service.ts:1574-1590, 1662-1687`). (b) **booking date**: pure SQL on `reservation_created_at`/`paid_at`. (a) matches what admins mean by "reserved in March". It costs one paged Dotypos call per range leaf. |
| Has-not (negated reservation leaves) | Same | Evaluated as a complement **within the universe**, never against all Dotypos customers. |
| Locale (cs/en) | No Dotypos field. Local sources: `auth.user.locale` (nullable, `ws/db/schema/auth.ts:39-46`), `workspace_reservations.locale` (`:124`), consent `locale`. | Compute the **resolved send locale** (see §3) and filter on that value, so the filter and the rendered language always agree. |
| Dotypos tags | Dotypos customer `tags` | In memory after hydration. |
| Dotypos discount group | Dotypos `_discountGroupId` | In memory after hydration. Show names via the modelled discount-group endpoints. |

### Evaluation order

1. **Universe** U = distinct `dotypos_customer_id` over reservations ∪ account links ∪ consents. For marketing, use active consents only. Volume is bounded by the Workspace customer base.
2. **Local pass.** Run each local leaf as one set-returning SQL query over U. Evaluate the AND/OR tree per customer with three-valued logic: Dotypos leaves are *unknown*. Drop customers whose result is already `false`.
3. **Hydrate** the survivors with `getCustomers({ ids })` in chunks of about 100 IDs: one page each, which keeps the URL short. Run the chunks sequentially or at low concurrency. About 1k recipients means about 10 requests.
4. **Dotypos pass.** Resolve the tag and discount-group leaves, and drop customers that are `deleted`, missing from the response, or have an invalid email (see §3).
5. **Freeze** the result.

Every recipient needs a Dotypos read for its email anyway, so pushing tag and group filters down to Dotypos saves nothing within this universe. Pushdown (`tags|in`, `_discountGroupId|in`, AND-only) matters only if the product wants to reach Dotypos customers who never touched Workspace. That needs a new filtered list method and possibly a large unknown-size scan, and the docs give no OR for building nested groups. **Open decision:** is the universe "Workspace-known customers" (recommended) or "every Dotypos customer"?

## 3. Email and locale rules

- **Email = Dotypos profile `email`.** Transactional reservation emails already use the Dotypos customer email (`ws/features/reservation/backend/workspace-reservation.service.ts:188-197`; `ws/features/checkout/backend/fulfillment/workspace-reservation-email.service.tsx:562-584, 602-672`). Don't use the Better Auth login email: it can differ from the profile email, and preview branches inherit *real* production login emails (`.agents/skills/deskohub-workspace-e2e/references/preview-workflow.md:87`).
- **Validation:** reuse `reservationCustomerEmailSchema` (trim, required, ≤255, `validator/isEmail`; `ws/features/reservation/reservation-contact.ts:25-35`). A missing or invalid email, a deleted customer, or an ID Dotypos doesn't return becomes an **excluded recipient with a reason** in the preview, not a silent drop.
- **Duplicates:** dedupe the *eligible* customers by trimmed lowercase address (Dotypos lookup normalisation, `packages/dotypos/src/backend/service.ts:333-344`), so each record's consent was already checked. Send once and surface the duplicate group in the preview. The `deskohub-dotypos` skill says never to merge case-variant customers silently. Pick the record deterministically, for example by most recent reservation, then lowest ID.
- **Locale:** extend the existing reservation-email resolver (linked account preference, else reservation locale; `ws/features/account/backend/customer-email-locale.service.ts:50-73`; the guest branch falls back to the reservation locale in `workspace-reservation-email.service.tsx:116-124`) into a customer-level resolver: account `locale` → most recent reservation `locale` → consent `locale` → `cs`. Map the stored `cs-CZ`/`en-US` values to the campaign's `cs`/`en`.
- **No local email storage:** `ws/db/schema/no-pii-columns.test.ts` forbids `email`/`name`/`phone` column fragments outside the Better Auth allowlist. The frozen list therefore stores Dotypos customer ID, resolved locale, and status/exclusion reason. The email is re-read by ID at delivery. Encrypting it (pgcrypto, as accounting documents do) is the alternative if the user wants the address itself frozen. **Open decision.**
- **Unsubscribe/suppression:** no suppression or bounce table exists. Marketing opt-out is consent withdrawal (`withdrawn_at`). Operational campaigns have no opt-out store.

## 4. Synthetic data in preview and E2E

- Preview uses a real **E2E Dotypos cloud**, and production credentials are forbidden there (`preview-workflow.md:42, 49, 61`; CI maps `WORKSPACE_E2E_DOTYPOS_*` → `DOTYPOS_*`). All Dotypos profile and reservation data in previews is synthetic (`:87`).
- E2E customers are created through `findOrCreateCustomer` with `testEmailAddress` (`localPart@deskohub.test`) (`ws/e2e/checkout/data.ts:98-118`; `packages/test-email/src/test-email-address.ts:15-20`; `ws/e2e/integrations/dotypos.ts:458-493`). The service has no customer delete, so the E2E cloud accumulates customers. Campaign E2E should scope its audience with a run-unique tag and assert the frozen list contains only that run's customers.
- Routing sends a message whose recipients are all on `EMAIL_TEST_DOMAIN` to Console. Any other recipient goes to Resend, and a real person using a preview gets real mail (`packages/email/backend/email-routing.ts:19-33, 64-83`; `preview-workflow.md:43`). Bulk sends should add a **fail-closed non-production guard** that refuses a send if any resolved recipient is outside the test domain.
- Unit tests: `DotyposServiceMock = Layer.mock(DotyposService)` with per-operation stubs such as `getCustomers` (`packages/dotypos/src/backend/service.mock.ts:1-4`; `ws/features/administration/administration.service.test.ts:69-73`). Postgres-level resolution tests belong in colocated `*.postgres.test.ts`.

## 5. Existing caching

None for customers. Only the Dotypos access token is cached, for 59 minutes (`packages/dotypos/src/backend/api.ts:75-91`). Nothing mirrors profiles locally, and the no-PII rule argues against adding a mirror. Dotypos does offer `CUSTOMER` webhooks (docs `others/webhook/`), but with under ~1k recipients per send, fetching fresh at send time is cheap and keeps the data consistent. Don't add a cache.

## Risks

- **Rate limits are undocumented.** Keep hydration sequential or at low concurrency, and rely on the existing 429 retry. One send is about 10 requests, plus range-leaf reservation listings.
- **Dotypos outages** (see the 2026-10-11 incident): resolution must fail as a whole, show a retryable error in the preview, and leave the send unfrozen. Never freeze a list built from partial hydration.
- **Consistency:** read local leaves in one transaction. Dotypos reads are point-in-time per chunk. Membership is frozen at resolution; the delivery-time re-read of email and consent is deliberate.
- **Date-range semantics** (occupancy versus booking) and the **universe scope** need product decisions before implementation.
- `getCustomers` includes deleted customers, so filter `deleted === true` explicitly.
