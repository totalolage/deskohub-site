# Reservation families

- Workspace reservation families use `kind: "cowork" | "meeting-room"`.
- Complete family branches use `Match.discriminatorsExhaustive("kind")`.
- `entryTier` refines cowork reservations only and never contains
  `"meeting-room"`.
- Effect-native errors and protocol unions may still use `_tag`; this rule only
  concerns the reservation-family domain discriminator.

Keep reservation-family-specific schemas and projections in the corresponding cowork or meeting-room domain modules. Generic checkout and reservation modules compose those family contracts instead of redeclaring family rules.
