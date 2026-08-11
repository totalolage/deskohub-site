# Reservation families

## Contents

- [Family boundaries](#family-boundaries)
- [Meeting-room duration intent](#meeting-room-duration-intent)
- [Product identities and keys](#product-identities-and-keys)

## Family boundaries

- Workspace reservation families use `kind: "cowork" | "meeting-room" | "office"`.
- Complete family branches use `Match.discriminatorsExhaustive("kind")`.
- `entryTier` refines cowork reservations only and never contains
  `"meeting-room"`.
- Effect-native errors and protocol unions may still use `_tag`; this rule only
  concerns the reservation-family domain discriminator.

Keep reservation-family-specific schemas and projections in the corresponding cowork, meeting-room, or office domain modules. Generic checkout and reservation modules compose those family contracts instead of redeclaring family rules.

Office reservations span an inclusive range of Prague calendar dates. They
always start at Prague midnight on the first date and end at Prague midnight
after the last date, so DST days remain whole calendar days rather than fixed
24-hour periods. Price each selected day as the base daily office price plus
the per-seat daily price for every reserved seat. Carry the total positive
integer as `seats` through the form, advertised price, normalized reservation,
availability query, quote, checkout, Dotypos hold, email, and status view.
Never translate it through guest, attendee, additional-person, or party-size
fields. The reservation form presents seat counts from one through the table
capacity, and Dotypos `seats` stores that same value. On the reservation page,
source every visible office price from the advertised quote: show its
`accessAmount` as the base price and derive each seat choice from its
`seatAmount` multiplied by `seats`. Do not reproduce catalog amounts as
client-side constants.

The office form captures one `startsOn` date and a positive `dayCount`, then
derives the inclusive `endsOn` date at the form-to-order boundary. Query office
calendar availability without seats or an interval for every date from the
current Prague date through one calendar month later. Use the returned
`unavailableDates` both to disable start dates and to cap `dayCount` at the day
before the first unavailable date. The inclusive last reservation day must
never be later than the current Prague date plus one calendar month; enforce
that at both the form and untrusted server input boundaries.

Office product identity is `{ kind: "office", seats, dayCount }` with product
key `office:${seats}:${dayCount}`. Build `dayCount` from the inclusive Prague
date range. Persist only `{ kind: "office" }` locally because Dotypos owns the
reservation facts; project confirmed timing and seats from Dotypos. Do not
weaken the sold-product identity to model discount eligibility.

Exactly one assignable Dotypos table may carry the office reservation tag. It
is exclusive for the entire reservation interval. Its configured seat capacity
determines the seat choices shown by the form, so calendar availability is
independent of the selected choice. Any existing occupancy greater than zero
makes it unavailable regardless of the remaining capacity. Treat multiple
assignable office-tagged tables as invalid configuration instead of silently
selecting among them.

Meeting-room eligibility is bounded by the reservation's exclusive end, not its
start. A reservation may be submitted or paid after it starts while its end has
not passed; reject it only after the end is in the past.

## Meeting-room duration intent

Model the purchasable meeting-room duration as the exact semantic union
`{ unit: "hour", amount: 1 | 4 } | { unit: "day", amount: 1 }`. Carry that
intent, together with the selected Prague calendar date, through form decoding,
advertised pricing, normalized reservations, quote fingerprints, checkout
details, and external reservation creation.

A day is a calendar period, not 1,440 elapsed minutes. Project the semantic
duration into an interval in one time-domain boundary:

- hourly products add elapsed hours to the selected Prague start time;
- the day product starts at the selected date's Prague midnight and ends at the
  next Prague midnight, including 23- and 25-hour DST days.

Do not infer a meeting-room product identity or quoted price from an interval,
and do not normalize a rolling 24-hour interval into a calendar day. Confirmed
reservation presentation may classify the provider-owned interval as whole day
only when it spans consecutive Prague midnights. `Temporal.PlainDate` and
`Temporal.ZonedDateTime` are the arithmetic bridge; do not expose
`Temporal.Duration` as the serialized product identity because it does not
encode the required midnight anchor.

Use semantic meeting-room durations as the only catalog, quote, summary,
discount-application, checkout, and integration identity. Do not retain or
derive a minute-count product identity. Meeting-room product keys use
`meeting-room:hour:1`, `meeting-room:hour:4`, and `meeting-room:day:1`.

Local stored meeting-room details contain only the reservation-family
discriminator. Dotypos owns actual reservation facts, while transient signed
checkout details carry semantic duration into pricing and hold creation. Do not
persist duration merely to duplicate that provider-owned state.

Cowork compatibility-field enrichment owns its field contract and complete partial family match in the cowork domain. Make the enricher generic over a reservation carrying decoded family details, project cowork details there, and return empty cowork fields for every non-cowork family. Generic repositories compose family enrichers in one concrete composition function and derive the aggregate return type from that function instead of importing or redeclaring family-specific field types. Identify that composition point for adding future family enrichments.

## Product identities and keys

A product key must encode the complete product identity, including its reservation family. Never use a cowork tier or meeting-room duration by itself as a product key.

- Cowork identities use `{ kind: "cowork", tier }` and keys use `cowork:${tier}`.
- Meeting-room identities use `{ kind: "meeting-room", duration }` and keys use `meeting-room:${unit}:${amount}`.
- Office identities use `{ kind: "office", seats, dayCount }` and keys use
  `office:${seats}:${dayCount}`.
- Checkout summary item keys add the presentation prefix, for example `product:cowork:basic`.

Discount configuration targets reservation families, not exact products. Its
strict target union is `{ kind: "cowork" } | { kind: "meeting-room" } |
{ kind: "office" }`, and a target matches every exact product identity with
the same `kind`. Persist these values as `product_target`. Quotes, purchases,
commitments, summaries, and immutable discount applications continue to carry
the complete `product_identity`; reduce an identity to `{ kind }` only when
checking discount eligibility.

Define each family target schema beside that family's exact identity schema,
then compose the cross-family target as their strict union. Family-sensitive
availability errors and other shared projections compose those family-owned
types instead of redeclaring an anonymous union. Cross-family conversion and
dispatch must be exhaustive so a new reservation family produces a type error.

Define each identity schema, key schema, and key constructor in its reservation-family domain module. The cross-family product-identity module only composes those schemas and dispatches exhaustively to the family constructors.

Derive downstream schemas from the family identity schema fields instead of redeclaring the same literals. Import family identity types and codecs directly; do not introduce feature-specific aliases or re-exports for them.

Construct identity keys through the family constructor or the cross-family
dispatcher. Do not independently interpolate them in checkout quote
construction or rendering code, and do not use exact identity keys for
family-only discount targets.

An advertised-price batch contains the typed request as its only selection
state. Derive cowork tier, meeting-room duration, and office seats from the
request's family details; do not return a parallel `{ tier | duration | seats,
request }` wrapper that can drift from the quoted reservation.

Generic checkout pages own cross-family exhaustive dispatch and shared visual
primitives. Family-specific status projections and summary item rendering live
in family-named modules, including existing families when one new family would
otherwise introduce a one-off branch in the generic component.
