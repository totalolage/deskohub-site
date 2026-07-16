# Reservation families

Discriminate Workspace reservation families with `_tag: "cowork" | "meeting-room"`.

Treat `entryTier` as a refinement of cowork reservations only. Never use `"meeting-room"` as an `entryTier` value.

Keep reservation-family-specific schemas and projections in the corresponding cowork or meeting-room domain modules. Generic checkout and reservation modules compose those family contracts instead of redeclaring family rules.
