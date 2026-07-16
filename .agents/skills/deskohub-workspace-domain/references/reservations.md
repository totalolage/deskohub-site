# Reservation families

- Workspace reservation families use `kind: "cowork" | "meeting-room"`.
- Complete family branches use `Match.discriminatorsExhaustive("kind")`.
- `entryTier` refines cowork reservations only and never contains
  `"meeting-room"`.
- Effect-native errors and protocol unions may still use `_tag`; this rule only
  concerns the reservation-family domain discriminator.
