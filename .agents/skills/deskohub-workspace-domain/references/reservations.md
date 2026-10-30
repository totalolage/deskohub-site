# Reservation families

The [reservation product specification](../../../../apps/deskohub-workspace/docs/reservation-products.md) defines each family's offers, prices, eligibility, and limits. This reference covers how to model them.

## Family modules

- Families use the discriminator `kind: "cowork" | "meeting-room" | "office"`. Branch over all families with `Match.discriminatorsExhaustive("kind")`. Effect errors and protocol unions may still use `_tag`.
- Each family owns its identity schema, product-key schema, key constructor, discount-target schema, and family-specific schemas and projections in `features/reservation/cowork-reservation-product.ts`, `meeting-room-reservation.ts`, or `office-reservation.ts`.
- Cross-family modules only compose family contracts and dispatch exhaustively, so a new family produces a type error: `features/checkout/product-identity.ts` for identities and keys, and `features/discounts/product-target.ts` for targets. Compose family-owned types for shared projections, such as family-sensitive availability errors, instead of redeclaring an anonymous union.
- Derive downstream schemas from the family schema fields instead of redeclaring literals. Import family identity types and codecs directly, without feature-specific aliases or re-exports.
- `entryTier` refines cowork only.
- Generic checkout pages own cross-family dispatch and shared visual primitives. Put family-specific status projections and summary item rendering in family-named modules, such as `features/checkout/checkout-summary-office.ts`. Move an existing family into its own module when a new family would otherwise add a one-off branch to a generic component.
- Reservation repositories compose family field enrichers in `withReservationKindFields` (`features/reservation/backend/workspace-reservation.repository.ts`) and derive `WorkspaceReservation` from its return type. Add future family enrichments there. Each enricher is generic over a reservation with decoded family details and returns empty fields for other families, like `withCoworkProductFields`.

## Product identities, keys, and targets

| Family | Identity | Product key |
| --- | --- | --- |
| Cowork | `{ kind: "cowork", tier }` | `cowork:${tier}` |
| Meeting room | `{ kind: "meeting-room", duration }` | `meeting-room:${unit}:${amount}` |
| Office | `{ kind: "office", seats, dayCount }` | `office:${seats}:${dayCount}` |

- A key encodes the complete identity, including the family. Never use a tier or duration alone as a key.
- Build keys only through the family constructor or `getWorkspaceProductKey`. Never interpolate them in quote construction or rendering code. Checkout summary item keys add a `product:` prefix, for example `product:cowork:open-space`.
- A discount or Calendar sale target names a reservation family (`{ kind }`) or, for cowork, one saleable tier (`open-space` or `reserved-desk`); a cowork target without a tier covers every cowork tier, including historical ones. Targets are stored as `product_target`.
- Quotes, purchases, commitments, summaries, and discount applications carry the complete `product_identity`. Keep the tier in eligibility matching with `workspaceProductTargetMatches`; never reduce an identity to `{ kind }` before matching, or a `reserved-desk` target could match `open-space`.
- An advertised-price batch carries the typed request as its only selection state. Derive tier, duration, or seats from the request's family details instead of returning a parallel wrapper that can drift.

## Persistence

Dotypos owns reservation facts. Local stored details for offices contain only the family discriminator, `{ kind: "office" }`. Meeting-room details add the optional purchased `duration` and the optional `earlySetup` flag, which says how to read the Dotypos interval (see [Meeting rooms](#meeting-rooms)). Project confirmed timing and seats from Dotypos. Transient signed checkout details carry duration and seats into pricing and hold creation. Don't persist them to duplicate provider state.

Keep historical and provider-owned projections structural, so current purchase limits never make older data undecodable. Historical cowork tiers stay decodable.

Read `workspace_reservations.reservation_details` only through `StoredReservationDetails` (`features/reservation/backend/stored-reservation-details.server.ts`). Use `decode`, `decodeRow` or `decodeRows` where a malformed document must fail the read with the reservation's ID, and `project` where a view shows less instead. In SQL, use its `kind`, `property` and `earlySetupMeetingRoom` accessors; they yield null for a malformed value, never a cast error. Don't hand-build JSON paths or trust the column's Drizzle `$type`.

## Meeting rooms

- The duration is the semantic union defined by the catalog in `features/checkout/meeting-room-product-catalog.ts`: `{ unit: "hour", amount: 1 | 4 } | { unit: "day", amount: 1 }`. Carry it, with the selected Prague date, through form decoding, advertised pricing, normalized reservations, quote fingerprints, checkout details, and external reservation creation.
- Project duration into an interval at one time-domain boundary. Hourly products add elapsed hours to the Prague start time. The day product runs from the date's Prague midnight to the next Prague midnight, so it can last 23 or 25 hours.
- Never infer the product or price from an interval, and never normalize a rolling 24 hours into a day. Confirmed reservation display may classify a provider interval as a whole day only when it spans consecutive Prague midnights.
- Use `Temporal.PlainDate` and `Temporal.ZonedDateTime` for the arithmetic. Don't serialize `Temporal.Duration` as the identity, because it loses the midnight anchor. Never derive a minute-count identity.
- Eligibility checks the exclusive end, not the start.
- Early setup (`earlySetup`, `features/reservation/meeting-room-early-setup.ts`) holds the room from 15 minutes before the booked start. Dotypos stores that occupied interval; read the booked interval back through `decodeBookedReservation` with the stored details, and build the occupied one with `getMeetingRoomOccupiedInterval`. Overlap, `ensureAvailable`, and table assignment use the occupied interval; price, discounts, eligibility, and cancellation use the booked one. Details without the flag keep their booked interval.
- Each start-times entry carries `earlySetupAvailable`, the occupied interval evaluated by the same single-interval rule as the booked one. Meeting-room inventory starts the day before the start date, so a midnight start sees the previous evening's bookings. The form enables the checkbox only for a listed start whose setup is free, fetches the start list for a whole day too (its single midnight entry), and clears the choice once the list settles on a start that rules it out. Selection links write `earlySetup=true` only when chosen; absence means off.

## Offices

- The form captures `startsOn` and a positive `dayCount` and derives the inclusive `endsOn` at the form-to-order boundary. Build `dayCount` from the inclusive Prague date range.
- Carry the seat count as `seats` everywhere: form, advertised price, normalized reservation, availability, quote, checkout, Dotypos hold (`seats`), email, and status. Never route it through guest, attendee, or party-size fields.
- Office availability is queried without seats or an interval for every date from today through one calendar month ahead. Use the returned `unavailableDates` to disable start dates and to cap `dayCount` before the first unavailable date.
- Enforce the one-month horizon and the 672-hour limit at both the form and the untrusted server input (`features/reservation/office-reservation.ts`). Measure the elapsed hours between Prague midnights. Never reduce the rule to `dayCount <= 28`, because DST makes 28 days 671 or 673 hours.
- Source every visible office price from the advertised quote: `accessAmount` is the base price, and each seat choice is `seatAmount * seats`. Never hard-code catalog amounts on the client.
- Exactly one assignable Dotypos table tagged `reservation:office` must exist. `getOfficeReservationSeatCapacity` (`features/office/backend/office-reservation-capacity.ts`) treats any other count as invalid configuration. Its seat capacity sets the form's seat choices.

## Cowork Reserved Desk assignment

`features/checkout/backend/reservation/workspace-table-assignment.service.ts` builds the ranking occupancy for current `reserved-desk` assignments. Rank each enabled, displayable, assignable `cowork:open-space` table at `max(actual occupancy, seat capacity)`, and never add the two. Ranking is the only use of this value: candidate capacity and public availability use actual occupancy. Don't apply it to Open Space, historical tiers, meeting rooms, or offices.
