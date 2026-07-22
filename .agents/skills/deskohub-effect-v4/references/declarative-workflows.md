# Declarative workflows

Make every non-trivial Effect workflow declarative, including service, provider, repository, and complex domain implementations. Prefer `Effect.Do.pipe`, using:

- `Effect.bind` for effectful steps.
- `Effect.let` for pure derived values.
- `Effect.tap` for observational effects.
- A final `Effect.map` for the result.

Continue this structure through abstraction layers until reaching simple leaf operations where direct code is clearer. Do not force a trivial leaf calculation into `Effect.Do`; extract it into a named declarative pipeline when it becomes conditional or multi-stage.

Define a function implemented with an Effect generator as `Effect.fn("descriptor")(function* (...) { ... })`. Do not wrap `Effect.gen(function* (...) { ... })` in an arrow function.

Do not add a pass-through `Effect.fn` whose only behavior is renaming or reshaping arguments for an existing named Effect operation. Call the existing operation directly unless the wrapper adds real domain policy, composition, or behavior.

Do not wrap a pure, non-throwing calculation in `Effect.sync` merely because it appears inside an Effect workflow. Compute it directly. Keep `Effect.sync` for synchronous work whose throws or evaluation timing must be represented by the Effect.

Preserve existing domain types in workflow inputs and helpers instead of widening them to primitives such as `string`.

Type real operations to accept an object containing the named domain values they require. Pass those operations directly to `Effect.bind`, `Effect.let`, or `Effect.tap`; do not add adapters whose only job is converting an Effect accumulator into positional arguments.

```ts
Effect.Do.pipe(
  Effect.bind("candidates", findDiscountCandidates),
  Effect.let("eligible", collectEligibleDiscounts),
  Effect.let("ordered", orderDiscounts),
  Effect.bind("quote", applyDiscounts),
  Effect.map(({ quote }) => quote),
);
```

When a workflow starts from an existing object input, start with `Effect.succeed(input).pipe(...)` and bind from that record instead of rebuilding its fields with `Effect.Do` and `Effect.let`.

Keep `Effect.bind`, `Effect.let`, and `Effect.tap` callbacks small. Extract non-trivial work into named record-input operations and pass those operations directly to the pipeline.

Keep conditional execution inside Effect. Use `Effect.when`, `Effect.filterOrFail`, or the matching Effect/Match combinator instead of a JavaScript conditional whose branches return Effects.
