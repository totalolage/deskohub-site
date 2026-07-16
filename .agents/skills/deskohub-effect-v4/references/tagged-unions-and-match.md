# Tagged unions and Match

- Match discriminated unions with explicit cases and an exhaustive terminator. Do not use a fallback branch that silently accepts a newly added variant.
- Use `Match.tag` for `_tag` variants. Reserve `Match.when` for refinements on other fields.
- Use Effect tagged schema or type wrappers and their constructors to add `_tag`. Do not declare or construct `_tag` manually.
