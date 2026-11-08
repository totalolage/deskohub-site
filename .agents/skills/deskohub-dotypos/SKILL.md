---
name: deskohub-dotypos
description: Dotypos API, @deskohub/dotypos, DotyposService, OpenAPI contract, generated client, new endpoint, refresh token, Connector authorization, manual API inspection, request timeout, Dotypos customer email or phone, PostHog customer source, Custom REST warehouse source, customer export, ANALYTICS_WAREHOUSE_SOURCE_TOKEN, in-memory Dotypos, makeInMemoryDotypos, @deskohub/dotypos/testing, DotyposServiceMock, Dotypos test fake.
---

# Deskohub Dotypos

- For Connector authorization and refresh-token acquisition, read [references/authorization.md](references/authorization.md).
- For the PostHog Custom REST customer source (contract, field allowlist, access token, and PostHog setup), read [references/posthog-customer-source.md](references/posthog-customer-source.md).
- For manual API inspection, read [references/manual-diagnostics.md](references/manual-diagnostics.md). Before production access or log inspection, load `deskohub-workspace-operations` and follow its diagnostics reference.

## Package boundary

`packages/dotypos` (`@deskohub/dotypos`) layers the integration:

1. Contract: `openapi/dotypos-api.yaml`.
2. Generated client: `src/generated/`. Regenerate it with `bun run generate` in `packages/dotypos`; never edit it by hand.
3. Effect service: `DotyposService` in `src/backend/service.ts`. `DotyposService.Live` wires the generated client, access token, and fetch transport.
4. Configuration: apps decode their env into `DotyposRuntimeConfig` with `DotyposRuntimeConfigSchema` (`src/config.ts`), as `apps/deskohub-workspace/shared/backend/config/dotypos.config.ts` does.

## Reading many records by id

Use `getCustomersByIds(ids, options?)` or `getReservationsByIds(ids, options?)`. They deduplicate, batch internally and return a `ReadonlyMap`; missing records are omitted. List and paginated operations serve unfiltered, customer and time-range reads.

- `dotyposIdReadBatchSize` is an operational batch of 100, not a provider ID-filter maximum. The [official paging contract](https://docs.api.dotypos.com/api-reference/general/paging/) caps each page at 100 records. The [filtering contract](https://docs.api.dotypos.com/api-reference/general/filter/) gives no ID-count or URL-length maximum. Authenticated read-only probes on 2026-10-30 accepted 50, 100 and 101 distinct nonexistent signed-long IDs for customers and reservations, returning the documented empty 404 with a null body. Both resource OPTIONS requests returned 200 with GET allowed. The largest encoded URL was 2432 bytes. These probes establish bounded query acceptance, not positive-result cardinality or the actual provider ceiling.
- `dotyposIdReadRequests(uniqueIdCount)` uses the same batch rule. Count unique requested IDs, not returned records. It is exact for successful, unretried, single-page transport batches, excluding access-token exchanges. Failures may stop unsent batches. Both ID operations never retry or follow pagination; unexpected paging is `DotyposRejected{invalid-response}`. Keep retry-policy changes in the request-profile work.
- Default concurrency inherits the caller's limit. Set `concurrency: 1` for sequential automation reads. An optional `onBatchFailure` receives the typed failure and recovers that batch only; successful batches remain in the map. Without it the read fails. Administration degrades per batch for views, fails exports, and keeps its individual missing-customer fallback.
- Reservation ID reads accept the existing customer/time/order filters. Customer lifecycle and each context's name/email precedence remain caller policy. Backfill's database batch cap of 50 and reservation snapshot key groups of 50 are independent of provider transport batching.

## Add or change an operation

1. Read the official API documentation.
2. Send an authenticated `OPTIONS` request to the resource or item URL to confirm the supported methods. Never print the credentials.
3. Check the live response shape.
4. Model the endpoint in `openapi/dotypos-api.yaml`.
5. Regenerate the client and use the generated contract. Don't add a hand-written response decoder beside it.

If a real response fails generated decoding, fix the OpenAPI schema and regenerate.

## Request timeouts

- Prefer waiting for a slow Dotypos answer over failing the flow. The per-request timeout defaults to `dotyposApiTimeoutDefaultMilliseconds` (30 seconds, `@deskohub/dotypos/api-timeout`), and E2E uses the same value. Any budget that wraps a Dotypos call, such as an E2E finalizer, must leave room for at least one full per-request timeout. `getDotyposRequestWorstCase(apiTimeout)` gives `once` (one attempt), `retried` (every retry spent), `sequential(calls, each)` and `pagedLoad(pages)` for such budgets. A paginated list load keeps the pages it has read, so its retries resend only the failed page and share one budget across pages; `pagedLoad` grows with the page count, and an `"unknown"` page count has no finite bound, so cap such a load with its own deadline.
- A page whose `maxDuration` can't fit the per-request timeout plus retries caps its own Dotypos reads with `Effect.timeoutOrElse` and renders a degraded state. The reservation status page (`maxDuration = 60`) and access page (`maxDuration = 30`) cap theirs at 8 seconds. The cap bounds only the Dotypos reads; later steps, such as Igloohome issuance, can still run past `maxDuration`. Leave the shared default unchanged for these pages.

## Failure outcomes

`@deskohub/dotypos` reports failures as `DotyposUnavailable`, `DotyposRejected`, `DotyposUncertain`, `DotyposVersionConflict` and `DotyposReservationCancelledError`, following the provider-outcome convention in `deskohub-effect-v4` (services-and-layers.md, "Report provider outcomes").

- `getCustomer`, `getReservation` and `patchCustomer` return `Option`: `none` means Dotypos has no such record. A missing reservation at confirm time is `DotyposRejected{not-found}`.
- `confirmReservation` settles a replayed PATCH that meets 412 (`DotyposUncertain{conflict-after-replay}`) by rerunning its read, status match and PATCH once: CONFIRMED succeeds, CANCELLED fails `DotyposReservationCancelledError`, and NEW patches under the fresh ETag. A NEW reread that still carries the replayed ETag stays `DotyposUncertain` without another PATCH. A failed settling read or rerun PATCH stays `DotyposUncertain`, a plain 412 included. A plain 412 on the first PATCH stays `DotyposVersionConflict` and is not rerun. A live non-production check found that replaying a landed reservation PATCH with its original ETag returns an empty 412, and that a stale confirmation leaves a NEW reservation unchanged.
- Customer writes settle per operation. `updateCustomerVersion` takes the operation's own `holds` check; with it, a replayed PATCH that meets 412 rereads the customer once. A reread with a new ETag that holds the write gets one confirming If-Match PATCH of the same payload under the reread's ETag, and a confirmation that answers 200 and holds the write is the result. A new ETag alone doesn't prove the reread postdates the replay, so a stale reread that still holds the write must not succeed without that PATCH. A failed confirmation, a plain 412 included, stays `DotyposUncertain` and is not settled again. Every other reread stays `DotyposUncertain` without a PATCH: a failed one, one that still carries the replayed ETag, and one that does not hold the write. A mismatch is not a `DotyposVersionConflict`, because nothing shows Dotypos customer reads are monotonic (E2E polls discount-group reads until they converge), so a lagging reread could hide a landed write. `setCustomerDiscountGroup`, `updateCustomerBillingDetails`, `updateCustomerDetails`, `updateCustomerProfile`, `expireCustomer` and `reactivateCustomer` settle this way. Billing details hold when every billing field equals the written value exactly; an empty value also matches a missing or null field. `updateCustomerDetails` checks the payload it sent: every trimmed text field under the same rule, and the normalized E.164 phone exactly only when the payload includes one. An absent or unparseable phone is left out of the PATCH, so any stored phone holds that write; never add the phone to the check or the payload when it was omitted. How Dotypos normalizes stored text is unprobed, so a case or whitespace difference, or a phone stored in another format, stays `DotyposUncertain`. `updateCustomerProfile` is the customer's own profile edit: it writes every trimmed text field except the email, and its phone always: blank is the explicit clearing, and any other value is a caller-parsed E.164 phone. It holds when a customer that is not deleted carries every written field under the billing rule and the written phone exactly (a blank also matches missing or null). `expireCustomer` writes an expiry a minute before the current clock and holds when `customerLifecycle` reads the customer as expired; a deleted customer does not hold it. `reactivateCustomer` clears the expiry and holds when the customer is not deleted and has no expiry. These three return `Option`, none when the customer is missing. A genuine conflict stays `DotyposVersionConflict`; the account adapter, not the package, refreshes once after it with `Effect.retry` and `Schedule.recurs(1)`, and never retries `DotyposUncertain`. `patchCustomer` doesn't settle; keep it for raw test-fixture patches only. A live check found that same-value PATCHes also change the ETag, so settle by the record's fields and never infer whose write landed from the ETag.
- Annotate error channels with `DotyposReadFailure`, `DotyposWriteFailure` or `DotyposConditionalWriteFailure`.
- Log a failure with `dotyposFailureLogFields(failure)` and store `dotyposFailureCode(failure)` as a failure code.
- The status-to-outcome classifier, the retry ceilings (`src/backend/request-profiles.ts`) and ETag replay stay private to the package. To change how a status or request is treated, edit the classifier or the table and the table-driven test in `src/backend/service.test.ts`. Creation requests retry only `rate-limited` and `empty-response`.
- In tests, fail a `DotyposServiceMock` operation with the public classes, for example `new DotyposUnavailable({ operation: "getCustomer", reason: "timeout" })`. Return `Option.none()` for a missing record. Never fabricate an HTTP status.

## Test adapters

- `makeInMemoryDotypos(seed, options?)` from `@deskohub/dotypos/testing` is a stateful `DotyposService` (`.service`, `.layer`). Seed customers, reservations, tables and discount groups; a write changes what later reads return, so assert a write by reading it back. Change `.customers` or `.reservations` directly only to model an edit made outside Workspace.
- It models ID lookups and ID reads through the package's own batching and validation, the customer, start-time and order filters, 100-record pages, the active-overlap filter, a new `versionDate` on every write, and the create, confirm and cancel transitions. Customer search and lookup, customer creation, details and profile writes, `patchCustomer`, products, categories and change listings die naming the operation; stub them yourself.
- Inject failures by spreading `.service` into `DotyposServiceMock` with an override. `onRequest` runs before each request it answers, once per ID batch; use it for request counts, latency or gating, not to fail whole operations.
- `in-memory-dotypos.contract.test.ts` runs the same cases against Live over fixture responses. It shows the two adapters read those shapes alike, not that the fake matches live Dotypos. When a probe or a Live change alters an outcome the fake models, update the fake and that suite together.
- Prefer it over a hand-built `DotyposServiceMock` when a test reads records back or spans several operations; a test that stubs one call can keep `DotyposServiceMock`.

## Record ids

Read records always carry an id. `id` is required on the `Reservation`, `Customer` and `Table` schemas in `openapi/dotypos-api.yaml`, which every read references, so `DotyposReservation`, `DotyposCustomer` and `DotyposTable` carry a branded, trimmed id. Don't guard a read record against a missing id or re-decode one. A read response without an id fails generated decoding as `DotyposRejected{invalid-response}`. Read-only probes on a non-production cloud on 2026-11-04 found a string id on every list and item read of tables, reservations and customers, deleted customers included, and every item read returned the requested id; some customer ids are negative signed longs. Item reads keep the returned id rather than substituting the requested one.

Write responses are unprobed, so they keep their id fallbacks:

- Writes and the bulk `replace*` request items reference `ReservationWriteRecord` and `CustomerWriteRecord`, whose id is optional. Keep new write operations on these schemas until a write probe proves the id.
- A write that addresses a known id (reservation and customer PATCH, the customer fill PUT) keeps that id when the response omits it.
- `createReservation` fails as `invalid-response` without a response id.
- `createCustomer` and `findOrCreateCustomer` return `DotyposCustomerWriteRecord`, which may lack the id. Callers keep their fallback: the account adapter rereads by exact email, and checkout and invoice administration fail with their missing-id errors.

## Customer records

- Compute lifecycle with `customerLifecycle(customer, now)` (`"active" | "expired" | "deleted"`) when you read the record; expiry depends on time, so never store it on a record. Each caller decides which lifecycles to show: Administration hides only deleted customers.

- Dotypos filters customer `email` only with `email|like|value`, a case-insensitive substring match (`ILIKE '%value%'`). Treat results as candidates and identify a customer only by a whole-address, case-insensitive comparison. Customers whose emails differ only by case are ambiguous; never merge them silently.
- Customer `versionDate` and `created` carry microseconds, and filters compare at that precision. Decode them with `DotyposTimestampFromString` and filter with `formatDotyposTimestamp`; `Date`, `DateTime`, and epoch-millisecond filter values drop the microseconds. Dotypos can't sort customers by `id`.
- Store the email as the customer entered it. Lookups, not writes, are case-insensitive.
- Customer writes and lookups take a `PhoneNumber` from `@deskohub/phone-number`, never entered text; the caller parses with `parsePhoneNumber` and leaves the phone out when the text holds none. An absent phone never overwrites the stored Dotypos phone: omit the field from update patches. Only an explicit clearing path, such as the customer's own profile edit, sends a blank value.
