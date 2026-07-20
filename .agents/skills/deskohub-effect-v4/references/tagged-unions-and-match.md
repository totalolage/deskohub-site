# Tagged unions and Match

- Match discriminated unions with explicit cases and an exhaustive terminator. Do not use a fallback branch that silently accepts a newly added variant.
- Use `Match.tag` for `_tag` variants. Use `Match.discriminatorsExhaustive(field)` for complete unions discriminated by another domain field. Reserve `Match.when` for predicates and partial refinements.
- Use Effect tagged schema or type wrappers and their constructors to add `_tag`. Do not declare or construct `_tag` manually.
- Use `Data.TaggedEnum` for handwritten tagged projection unions instead of intersecting member types with manually declared `_tag` fields.
- When the variants already exist as Effect tagged classes or errors, compose those types with a simple union. Do not re-project existing variants through `Data.TaggedEnum`.
