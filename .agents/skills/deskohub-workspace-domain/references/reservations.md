# Reservation families

- Workspace reservation families use `kind: "cowork" | "meeting-room"`.
- Complete family branches use `Match.discriminatorsExhaustive("kind")`.
- `entryTier` refines cowork reservations only and never contains
  `"meeting-room"`.
- Effect-native errors and protocol unions may still use `_tag`; this rule only
  concerns the reservation-family domain discriminator.

Keep reservation-family-specific schemas and projections in the corresponding cowork or meeting-room domain modules. Generic checkout and reservation modules compose those family contracts instead of redeclaring family rules.

Cowork compatibility-field enrichment owns the complete partial family match in the cowork domain. Make the enricher generic over a reservation carrying decoded family details, project cowork details there, and return empty cowork fields for every non-cowork family so generic repositories do not own cowork behavior.

## Product identities and keys

A product key must encode the complete product identity, including its reservation family. Never use a cowork tier or meeting-room duration by itself as a product key.

- Cowork identities use `{ kind: "cowork", tier }` and keys use `cowork:${tier}`.
- Meeting-room identities use `{ kind: "meeting-room", durationMinutes }` and keys use `meeting-room:${durationMinutes}`.
- Checkout summary item keys add the presentation prefix, for example `product:cowork:basic`.

Define each identity schema, key schema, and key constructor in its reservation-family domain module. The cross-family product-identity module only composes those schemas and dispatches exhaustively to the family constructors.

Derive downstream schemas from the family identity schema fields instead of redeclaring the same literals. Import family identity types and codecs directly; do not introduce feature-specific aliases or re-exports for them.

Derive downstream schemas from the family identity schema fields instead of redeclaring the same literals. Import family identity types and codecs directly; do not introduce feature-specific aliases or re-exports for them.

Construct keys through the family constructor or the cross-family dispatcher. Do not independently interpolate them in discount targeting, checkout quote construction, or rendering code, and do not create persistence-specific aliases for a family product key.
