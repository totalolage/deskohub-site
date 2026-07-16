# Schemas, errors, and boundaries

- Use Effect Schema codecs and checks for runtime domain validation when the value has a schema. Do not duplicate schema validation with manual predicate chains.
- Use Effect Schema branding utilities for schema-backed branded values. Do not hand-roll `unique symbol` brands.
- Annotate branded Effect schemas with a stable identifier and domain description.
- Use Effect Schema rather than Zod for new schema definitions.
- Use branded domain identifier types in contracts and error fields instead of plain strings.
- When mapping an error into a domain error, preserve the original error in the wrapping error's `cause` property.
