# Reservation families

- Workspace reservation families use `kind: "cowork" | "meeting-room"`.
- Complete family branches use `Match.discriminatorsExhaustive("kind")`.
- `entryTier` refines cowork reservations only and never contains
  `"meeting-room"`.
- Effect-native errors and protocol unions may still use `_tag`; this rule only
  concerns the reservation-family domain discriminator.

Keep reservation-family-specific schemas and projections in the corresponding cowork or meeting-room domain modules. Generic checkout and reservation modules compose those family contracts instead of redeclaring family rules.

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
discount, checkout, and integration identity. Do not retain or derive a
minute-count product identity. Meeting-room product keys use
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
- Checkout summary item keys add the presentation prefix, for example `product:cowork:basic`.

Define each identity schema, key schema, and key constructor in its reservation-family domain module. The cross-family product-identity module only composes those schemas and dispatches exhaustively to the family constructors.

Derive downstream schemas from the family identity schema fields instead of redeclaring the same literals. Import family identity types and codecs directly; do not introduce feature-specific aliases or re-exports for them.

Construct keys through the family constructor or the cross-family dispatcher. Do not independently interpolate them in discount targeting, checkout quote construction, or rendering code, and do not create persistence-specific aliases for a family product key.
