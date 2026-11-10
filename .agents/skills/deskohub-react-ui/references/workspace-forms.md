# Workspace forms

- Use React Hook Form for editable values and client validation. Pass the Effect schema straight to `effectSchemaResolver` from `@deskohub/effect-schema-resolver`, not through `Schema.toStandardSchemaV1` or `standardSchemaResolver`.
- Type the form as `useForm<typeof schema.Encoded, unknown, typeof schema.Type>`: fields hold the encoded type and submit the decoded type.
- The resolver already sets `errors: "all"`. Pass only other parse options, such as `{ onExcessProperty: "error" }`. A schema that needs Effect services gets them through the resolver's `services` option.
- When a Server Action validates the same rules through Standard Schema V1, keep that adapter on the action contract and give the resolver the underlying Effect schema.
- Keep each existing submission path: GET navigation, Better Auth browser requests, Server Actions, or local confirmation callbacks.
- Let React Hook Form or the submission action own pending state. Add separate state only for a distinct workflow outcome. A synchronous duplicate-submit guard needs a regression test.
- Reset hydrated forms in the action completion callback. Use an effect only to sync an external source with no completion callback, such as a native action result arriving after hydration, and cover it with a regression test.
- Declare parameterless schemas and default values as module constants. Use a schema factory only when it takes caller input, such as a locale.
- Don't memoize a schema or resolver without a demonstrated identity or performance need.
- Run Effect Schema directly for server validation. Convert to Standard Schema V1 only where the consuming API requires it, such as the safe-action, environment, or query boundary.
