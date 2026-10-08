# Workspace forms

- Use React Hook Form for editable values and client validation, with Effect Schema exposed through Standard Schema V1 at the resolver boundary. Keep existing GET navigation, Better Auth browser requests, Server Actions, and local confirmation callbacks as their respective submission paths.
- Let RHF or the submission action own pending state. Keep separate state only for a distinct workflow outcome, and justify synchronous duplicate-submit guards with a regression test.
- Reset hydrated forms in the action completion callback. Use an effect only when synchronizing an external source that has no completion callback, such as a native action result arriving after hydration; cover that boundary with a regression test.
- Declare parameterless schemas and default values as constants. Use a schema factory only when it depends on caller input, such as an explicit locale.
- Rely on the React Compiler for ordinary derived values. Do not add manual memoization for a schema or resolver without a demonstrated identity or performance requirement.
- Execute Effect Schema directly for server validation. Convert to Standard Schema V1 only when the consuming API requires that contract, such as the RHF resolver or safe-action boundary.
