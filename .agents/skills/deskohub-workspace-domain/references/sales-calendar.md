# Sales calendar discounts

Model Workspace sales calendar events as references to stored discount definitions:

- Treat the trimmed event description as exactly one discount UUID; reject rich-text wrappers, prose, or any additional content.
- Let Calendar own occurrence timing.
- Treat the Calendar title as operator-facing metadata only; never use it as a
  public label.
- Let Postgres own the complete locale-indexed public label map, adjustment,
  and product targets.
- Keep that locale-indexed map as the sole definition-label source. Do not add
  a second scalar operator or fallback label to stored discount definitions.
- Log malformed events and missing, malformed, or unavailable definitions at
  Error level, omit only the affected sale/definition, and keep every other
  correctly resolved discount. A whole Calendar failure yields no Calendar
  candidates and does not block initial discovery. Do not cache a partial
  resolution as a complete success.
- Treat reservation-page advertisement as an anonymous pricing boundary. It
  evaluates Calendar sales because they can be discovered without customer
  identity, and its integrity-protected snapshot explicitly records that
  customer-specific pricing has not been evaluated. Do not resolve or create a
  Dotypos customer merely to render an advertised price, and do not put PII in
  the snapshot.
- Once a Calendar discount has been advertised, do not silently omit it from a
  quote or signed summary. Its disappearance produces `pricing_changed` for the
  affected product. Do not add a newly available Calendar discount
  retrospectively during quote generation or final affirmation.
- After the advertised Calendar discounts are affirmed on reservation
  submission, the server may evaluate a Dotypos customer discount after
  identity resolution and include it for the first time in the signed summary
  without `pricing_changed`. That explicit customer-pricing exception does not
  apply to Calendar sales. Once shown, the customer discount follows the normal
  affirmation and `pricing_changed` rules for accepted discounts.
- Require a trimmed, non-empty label for every application locale and reject
  missing or unsupported locale keys. Never fall back across languages.
- Cache the complete locale-independent stored definition for Calendar
  advertisement discovery and resolve the concrete label only when creating
  the checkout candidate.
- Snapshot the resolved string in checkout and application history so later
  translation edits cannot rewrite what a customer saw.
- Do not reintroduce TOML sale configuration.
