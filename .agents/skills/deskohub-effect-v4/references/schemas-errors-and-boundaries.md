# Schemas, errors, and boundaries

- Use Effect Schema codecs and checks for runtime domain validation when the value has a schema. Do not duplicate schema validation with manual predicate chains.
- Type-link schemas that decode database rows or JSONB values to the inferred database type with an explicit `Schema.Decoder<DatabaseType>` annotation so the schema and persistence model cannot drift independently. Use a full `Schema.Codec<DatabaseType, EncodedType>` only when callers also encode; branded database fields commonly have an unbranded encoded representation.
- Use Effect Schema branding utilities for schema-backed branded values. Do not hand-roll `unique symbol` brands.
- Annotate branded Effect schemas with a stable identifier and domain description.
- Use Effect Schema rather than Zod for new schema definitions.
- Validate values at the strongest available layer, in this order: make invalid states structurally impossible, enforce trusted internal construction with TypeScript types, use lint rules, use focused tests, and add runtime decoding only as a last resort. Reserve `decodeUnknown` for untrusted boundary input rather than re-validating trusted internal values.
- Reuse Effect's built-in schemas, such as `Schema.NonEmptyString`, instead of redeclaring equivalent local helpers.
- When related struct schemas share fields, declare a base `Schema.Struct` and extend its `fields`. Do not declare a standalone fields object as a schema substitute.
- Use branded domain identifier types in contracts and error fields instead of plain strings.
- When mapping an error into a domain error, preserve the original error in the wrapping error's `cause` property.
- Expose one validated Effect-backed Server Action declaration API named `action`; do not split ordinary and "safe" actions into competing public boundary methods. Schema validation, middleware, and the public error protocol are part of the action boundary.
- Do not return Effect `Result` instances across a React Server Function boundary. They have a custom prototype and iterator and are not plain React Flight values. Keep the action transport envelope plain, or deliberately encode a separate serializable DTO rather than claiming the decoded value is still an Effect `Result`.
- Define fallible operations as Effects at their point of definition and carry expected failures through the typed error channel. Do not create throwing helpers and then recover by wrapping callers in `try`/`catch` or `Effect.try`. Reserve `Effect.try` and `Effect.tryPromise` for true third-party or platform boundaries that may throw or reject.
- Keep reusable framework-boundary mechanics in `@deskohub/next-effect`, including handler suspension, per-invocation Layer provision, Exit interpretation, cancellation selection, and host adapters. App boundary modules should supply only app-specific request context, public failure protocols, logging, telemetry, and composition policy.
- Parse external decimal percentages with Effect Schema and exact `BigDecimal` arithmetic. Do not hand-slice decimal strings or convert them through floating-point math.
