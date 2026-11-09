# Declarative workflows

Write every non-trivial Effect workflow declaratively, including services, providers, repositories, and complex domain logic. Use `Effect.Do.pipe` with:

- `Effect.bind` for effectful steps.
- `Effect.let` for pure derived values.
- `Effect.tap` for observational effects.
- A final `Effect.map` for the result.

```ts
Effect.Do.pipe(
  Effect.bind("candidates", findDiscountCandidates),
  Effect.let("eligible", collectEligibleDiscounts),
  Effect.let("ordered", orderDiscounts),
  Effect.bind("quote", applyDiscounts),
  Effect.map(({ quote }) => quote),
);
```

Carry this structure down through the layers until a leaf is simpler as direct code. When a leaf becomes conditional or multi-stage, extract it into its own named pipeline.

## Operations and inputs

- Type each operation to take one object of the named domain values it needs, and pass it directly to `Effect.bind`, `Effect.let`, or `Effect.tap`. Keep those callbacks small, and skip adapters that only turn the accumulator into positional arguments.
- When the workflow starts from an existing object, start with `Effect.succeed(input).pipe(...)` instead of rebuilding its fields with `Effect.Do` and `Effect.let`.
- Pass a value that structurally satisfies an input as is. Project fields only at a serialization, privacy, or persistence boundary.
- Keep existing domain types in inputs and helpers instead of widening them to primitives such as `string`.
- Call an existing named operation directly. Add an `Effect.fn` wrapper only when it adds domain policy, composition, or behavior.

## `Effect.fn` and lazy values

- Define a generator function as `Effect.fn("descriptor")(function* (...) { ... })`, not as an arrow that returns `Effect.gen`. The `prefer-effect-fn` Grit rule enforces this in Workspace production modules.
- For a parameterless wrapper around `Effect.tryPromise`, `Effect.promise`, `Effect.sync`, `Effect.try`, or `Effect.suspend`, define the Effect value directly and keep its trace with `Effect.withSpan`. Reads still run on each execution. The `prefer-effect-value` Grit rule catches `Effect.fn("...")(() => Effect.tryPromise(...))` and its siblings.
- Compute a pure, non-throwing value directly. Use `Effect.sync` only when throws or evaluation timing must be part of the Effect.

## Conditionals and recovery

- Keep conditional execution inside Effect with `Effect.when`, `Effect.filterOrFail`, `Option`, or `Match`, not a JavaScript conditional whose branches return Effects. The `prefer-effect-when` Grit rule rejects `condition ? effect : Effect.void` in the analytics modules only.
- To recover from an error with an optional plain value, use `Effect.orElseSucceed(() => undefined)`. Keep `Option` for absence that belongs to the domain.
- To inspect success and failure as data, use `Effect.result`. Don't collapse the error channel into a boolean and branch on it.
