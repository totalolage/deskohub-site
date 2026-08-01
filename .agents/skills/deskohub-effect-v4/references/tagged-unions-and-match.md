# Tagged unions and Match

- Match discriminated unions with explicit cases and an exhaustive terminator. Do not use a fallback branch that silently accepts a newly added variant.
- Use `Option` operations for `Option` values instead of matching their
  `Some`/`None` implementation tags with `Match`.
- When the `Some` branch maps a value and the `None` branch supplies a fallback,
  prefer `Option.map` followed by `Option.getOrElse` over a full match.
- Use `Match.tag` for individual `_tag` branches and
  `Match.tagsExhaustive` for exhaustive `_tag` handler maps. Use
  `Match.discriminatorsExhaustive(field)` for complete unions discriminated by
  another domain field. Reserve `Match.when` for predicates and partial
  refinements.
- Use `Match.when` patterns when nested or optional discriminators must be
  correlated. Do not compare their discriminator strings manually and then
  recover the relationship with casts or conditional spreads.
- Use Effect tagged schema or type wrappers and their constructors to add `_tag`. Do not declare or construct `_tag` manually.
- Use `Data.TaggedEnum` for handwritten tagged projection unions instead of intersecting member types with manually declared `_tag` fields.
- When the variants already exist as Effect tagged classes or errors, compose those types with a simple union. Do not re-project existing variants through `Data.TaggedEnum`.
