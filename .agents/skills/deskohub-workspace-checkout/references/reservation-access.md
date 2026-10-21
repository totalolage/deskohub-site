# Reservation access PIN

Code: `features/reservation-access/`, table `reservation_access_grants` (`db/schema/reservation-access-grants.ts`). Customer policy is in the [checkout specification](../../../../apps/deskohub-workspace/docs/checkout-lifecycle.md#payment-and-fulfillment). Standalone operator access codes belong to the administration skill.

## Disclosure

- The confirmation email carries a protected access link, never the PIN.
- Only the `view-access-code` permission discloses the PIN: capability links, the 24-hour access cookie the proxy sets when it exchanges one, and the account linked to the reservation's customer. Submission sets no access cookie. A reservation's author booking for someone else sees the status page, not the PIN (see `checkout-pages.md`).
- The access page resolves the PIN on every authorized request and shows it, with the exact programmed start and end, while the reservation is paid, locally confirmed, and live-confirmed in Dotypos.
- Never time-gate disclosure or clear an issued PIN by the application clock. Igloohome's programmed AlgoPIN bounds alone decide when the lock accepts it. Local bounds exist only for issuance, customer explanation, and schedule-change recovery.
- The signed access capability binds the reservation and locale, not a copied interval, so live Dotypos timing stays authoritative. Sign it with `RESERVATION_ACCESS_TOKEN_SECRET`, not the Pay-state keyring or provider credentials, and keep that secret for at least the longest future reservation lifetime.
- Never log, annotate, or return the PIN outside the authorized access response. Pass it as a `sensitiveDatabaseParameter`. Operator views show grant metadata only.

## Issuance

Paid fulfillment provisions an hourly Igloohome AlgoPIN before sending the access link; later requests reuse it. For the Retrofit Lock (OE1) linked to a Keypad (EK1), `IGLOOHOME_ALGOPIN_TARGET_DEVICE_ID` must be the EK1 device ID.

- Floor the start to the containing Prague hour and ceil the end to the next Prague hour boundary. The provider interval must start in the current or a future hour and span 1 to 672 hours. When a still-active reservation is first provisioned after its rounded start, use the current Prague hour through the rounded end. Persist the rounded scheduled start separately from the provider start so later timing changes compare against the original target.
- If a Dotypos timing change produces a different rounded interval, atomically reset the known issued grant and issue a replacement. A change within the same rounded interval reuses the PIN. Never turn a known move into ambiguous-provider reconciliation.
- Name the credential `Deskohub <grant-id>` (`makeReservationAccessName`), never with a reservation or customer identifier: Igloohome processes it in Singapore. `ensure` generates the grant ID and stores that name in `access_name` when it creates the grant, and claiming stores the name again before the request, so the stored name always matches the latest request or the one the first request will use. A reset to `pending` keeps the name, because a moved issued grant's replaced credential stays live. Grants that existed before the column were backfilled to `Deskohub <reservation-id>` and take the grant-ID name at their next request. A null name marks a grant that the previous deployment created during the rollout; `getReservationAccessName` shows `Deskohub <reservation-id>` for it, and the next claim by current code replaces it. If a previous deployment re-claims a grant that current code already named, it sends `Deskohub <reservation-id>` while the column keeps the grant-ID name, so for grants requested around the #780 release, recovery checks both names.
- Only production calls live Igloohome. Every other deployment uses the fixture service in `shared/backend/config/igloohome.config.ts`.

## Provider outcomes

Grant states: `pending`, `provisioning`, `issued`, `expired`, `failed`, `uncertain`.

- Provider 400, 401, 403, 404, and 415 are definitive rejections and may leave a retryable `failed` grant.
- Timeouts, transport failures, 5xx, undocumented statuses, malformed successes, and failures persisting a success are ambiguous. Record `uncertain` and never issue a second credential automatically; Igloohome has no idempotency key or lookup by `accessName`.
- A `provisioning` claim older than `reservationAccessProvisioningStaleAfterMilliseconds` carries the same risk. A fresher claim is still in progress.

To recover an `uncertain` or stale `provisioning` grant, the operator uses the Igloohome app over Bluetooth at the lock, finds the grant's access name, shown in the reservation's administration detail and in `dhw`, removes it or verifies it's absent, and confirms that cleanup. Only then reset the grant conditionally and retry. Without confirmation, wait for the possible credential to expire. A `failed` grant retries through normal issuance and fulfillment.
