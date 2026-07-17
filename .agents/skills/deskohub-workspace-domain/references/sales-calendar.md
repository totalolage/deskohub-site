# Sales calendar discounts

Model Workspace sales calendar events as references to stored discount definitions:

- Treat the trimmed event description as exactly one discount UUID; reject rich-text wrappers, prose, or any additional content.
- Let Calendar own occurrence timing.
- Treat the Calendar title as operator-facing metadata only; never use it as a
  public label.
- Let Postgres own the complete locale-indexed public label map, adjustment,
  and product targets.
- Treat a referenced definition that is absent from the current environment as
  an inactive sale: log it, grant no discount, and keep checkout available.
  Continue to fail closed for malformed stored definitions and database errors.
- Require a trimmed, non-empty label for every application locale and reject
  missing or unsupported locale keys. Never fall back across languages.
- Cache the complete locale-independent stored definition for Calendar quotes
  and resolve the concrete label only when creating the checkout candidate.
- Snapshot the resolved string in checkout and application history so later
  translation edits cannot rewrite what a customer saw.
- Do not reintroduce TOML sale configuration.
