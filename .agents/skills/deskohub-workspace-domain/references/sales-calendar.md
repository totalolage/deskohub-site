# Sales calendar discounts

Model Workspace sales calendar events as references to stored discount definitions:

- Treat the visible event-description content as exactly one discount UUID. Accept either the raw UUID or Google Calendar's canonical `<p><code>UUID</code></p>` storage wrapper; reject every other rich-text structure or additional content.
- Let Calendar own occurrence timing.
- Treat the Calendar title as operator-facing metadata only; never use it as a
  public label.
- Let Postgres own the complete locale-indexed public label map, adjustment,
  and product targets.
- Require a trimmed, non-empty label for every application locale and reject
  missing or unsupported locale keys. Never fall back across languages.
- Cache the complete locale-independent stored definition for Calendar quotes
  and resolve the concrete label only when creating the checkout candidate.
- Snapshot the resolved string in checkout and application history so later
  translation edits cannot rewrite what a customer saw.
- Do not reintroduce TOML sale configuration.
