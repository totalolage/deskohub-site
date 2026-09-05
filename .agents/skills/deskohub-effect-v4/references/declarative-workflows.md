# Declarative workflows

Make every non-trivial Effect workflow declarative, including service, provider, repository, and complex domain implementations. Prefer `Effect.Do.pipe`, using:

- `Effect.bind` for effectful steps.
- `Effect.let` for pure derived values.
- `Effect.tap` for observational effects.
- A final `Effect.map` for the result.

Continue this structure through abstraction layers until reaching simple leaf operations where direct code is clearer. Do not force a trivial leaf calculation into `Effect.Do`; extract it into a named declarative pipeline when it becomes conditional or multi-stage.

Define a function implemented with an Effect generator as `Effect.fn("descriptor")(function* (...) { ... })`. Do not wrap `Effect.gen(function* (...) { ... })` in an arrow function.
The root `lint/prefer-effect-fn.grit` custom rule enforces this convention for
the migrated boundary. `lint/prefer-effect-when.grit` rejects ternaries whose
fallback is `Effect.void`; use `Effect.when`, `Option`, or `Match` according to
the domain. Keep custom syntax rules under `lint/` and register them as Biome
plugins in `biome.json`; do not add them ad hoc to an application's ESLint
configuration.

For a parameterless wrapper around a lazy `Effect.tryPromise`, `Effect.promise`,
`Effect.sync`, `Effect.try`, or `Effect.suspend` constructor, define the direct
Effect value instead of `Effect.fn("...")(() => ...)`. Preserve its trace with
`Effect.withSpan`, and keep reads deferred until each run. The bounded
`lint/prefer-effect-value.grit` rule enforces this case in Workspace production
modules. It does not treat every no-argument factory as redundant, so
parameterized callbacks, generator callbacks, database or query factories, and
composition such as `Effect.all` remain outside the automated rule.

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

When an existing value structurally satisfies an operation input, pass it
through directly. Do not destructure away unrelated properties merely to make
the runtime object exactly match the declared input type; project fields only
at a real serialization, privacy, or persistence boundary.

Keep `Effect.bind`, `Effect.let`, and `Effect.tap` callbacks small. Extract non-trivial work into named record-input operations and pass those operations directly to the pipeline.

Keep conditional execution inside Effect. Use `Effect.when`, `Effect.filterOrFail`, or the matching Effect/Match combinator instead of a JavaScript conditional whose branches return Effects.

When deliberately recovering from an Effect error with an optional plain value,
use `Effect.orElseSucceed(() => undefined)` instead of converting the result to
`Option` and immediately unwrapping it. Keep `Option` when absence represents
the domain or conditional execution rather than error recovery.

When success and failure must both be inspected as data, use `Effect.result`.
Do not erase the error channel into true/false sentinels and then branch on the
boolean.

For a Next.js `"use server"` module, do not export the function returned by an
Effect action factory directly. Export an async bridge declared in that module
so Next assigns and resolves the Server Action identity. A successful production
build does not prove this works at runtime; keep the bridge covered by the
protected preview E2E action invocation.
