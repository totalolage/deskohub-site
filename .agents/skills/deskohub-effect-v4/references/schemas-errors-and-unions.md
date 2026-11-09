# Schemas, errors, and unions

## Validate at the strongest layer

Prefer, in order: make invalid states unrepresentable, enforce trusted construction with types, add a lint rule, add a focused test, and only then decode at runtime. Decode with `decodeUnknown*` only at untrusted boundaries, not to re-check trusted internal values.

## Schemas

- Write new schemas with Effect Schema, not Zod. Where a boundary takes Standard Schema, convert with `Schema.toStandardSchemaV1`.
- When a value has a schema, validate it with the schema's codecs and checks, not a parallel predicate chain.
- Link schemas that decode database rows or JSONB to the inferred database type with a `Schema.Decoder<DatabaseType>` annotation. Use `Schema.Codec<DatabaseType, EncodedType>` only when callers also encode; branded fields usually encode unbranded.
- Brand schema-backed values with `Schema.brand`, never a hand-rolled `unique symbol`. Annotate each branded schema with a stable identifier and a domain description.
- Use branded identifier types, not plain strings, in contracts and error fields.
- Reuse built-in schemas such as `Schema.NonEmptyString` instead of local equivalents.
- For struct schemas that share fields, declare a base `Schema.Struct` and extend its `fields`, not a standalone fields object.
- Add a version field or discriminator only when multiple live formats need different decoding.
- Parse external decimal percentages with Effect Schema and exact `BigDecimal` arithmetic, never string slicing or floating point.

## Errors

- Define fallible operations as Effects where you declare them, and carry expected failures in the typed error channel. Use `Effect.try` and `Effect.tryPromise` only at third-party or platform boundaries that can throw or reject. The `no-throw-in-workspace-effect-modules` Grit rule rejects `throw` in feature backend, service, adapter, repository, runtime, and catalog modules.
- When you wrap an error in a domain error, keep the original in `cause`.
- Put reusable cause-to-error mappers on the error class as short, domain-named, curried static properties, and pass them straight to `Effect.mapError`. `WorkspaceRouteFailure.internal` is the model.

## Tagged unions and `Match`

- Match a discriminated union with explicit cases and an exhaustive terminator, never a fallback that silently accepts a new variant or a two-case ternary.
- Use `Match.tag` for single `_tag` branches and `Match.tagsExhaustive` for a full `_tag` handler map. Use `Match.discriminatorsExhaustive(field)` for unions keyed by another field. Reserve `Match.when` for predicates, partial refinements, and correlating nested or optional discriminators; don't compare discriminator strings by hand and patch types with casts or conditional spreads.
- Handle `Option` with `Option` operations, not `Match` on `Some`/`None`. For map-then-fallback, use `Option.map` with `Option.getOrElse`.
- Let Effect tagged schemas, classes, and constructors add `_tag`; never declare or set it by hand.
- Use `Data.TaggedEnum` for handwritten tagged projection unions. When variants already exist as tagged classes or errors, union those types directly.
