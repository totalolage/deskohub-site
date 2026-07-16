# Schemas, errors, and boundaries

- Use Effect Schema codecs and checks for runtime domain validation when the value has a schema. Do not duplicate schema validation with manual predicate chains.
- Use Effect Schema branding utilities for schema-backed branded values. Do not hand-roll `unique symbol` brands.
- Annotate branded Effect schemas with a stable identifier and domain description.
- Use Effect Schema rather than Zod for new schema definitions.
- Validate values at the strongest available layer, in this order: make invalid states structurally impossible, enforce trusted internal construction with TypeScript types, use lint rules, use focused tests, and add runtime decoding only as a last resort. Reserve `decodeUnknown` for untrusted boundary input rather than re-validating trusted internal values.
- Use branded domain identifier types in contracts and error fields instead of plain strings.
- When mapping an error into a domain error, preserve the original error in the wrapping error's `cause` property.
- Define fallible operations as Effects at their point of definition and carry expected failures through the typed error channel. Do not create throwing helpers and then recover by wrapping callers in `try`/`catch` or `Effect.try`. Reserve `Effect.try` and `Effect.tryPromise` for true third-party or platform boundaries that may throw or reject.
- Parse external decimal percentages with Effect Schema and exact `BigDecimal` arithmetic. Do not hand-slice decimal strings or convert them through floating-point math.
