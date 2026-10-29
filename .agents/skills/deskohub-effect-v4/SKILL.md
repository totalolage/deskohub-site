---
name: deskohub-effect-v4
description: Effect V4 code, Context.Service, Layer, Effect.fn, Effect.Do workflow, Effect Schema, typed errors, retry and timeout, Match, tagged unions, runWorkspaceEffect, runWorkspaceEffectOrElse, runWorkspaceBrowserEffect, defineWorkspaceAction, defineWorkspaceRoute, Vercel Queue topic, defineQueueTopic, QueuePublisher, queue consumer, browser failure reporting, Effect bundle size.
---

# Deskohub Effect V4

The repository pins `effect` 4.0.0-beta.85 with a local patch. V4 APIs differ from V3; check `node_modules/effect` before you use an API you remember from V3.

Read the references that match the change. For a broad service or feature refactor, read all of them before you edit.

- Services, Layers, capabilities, module layout, mocks, outbound HTTP, provider calls, operation naming, concurrency, and barrels: [references/services-and-layers.md](references/services-and-layers.md).
- Workspace transactions, writers that commit with their caller, clients that never join, and advisory locks (`WorkspaceLocks`, `WorkspaceLockSections`): [references/workspace-transactions.md](references/workspace-transactions.md).
- Server actions, routes, pages, tasks, queue topics and consumers, the shared runtime, fail-open runs, and browser runs: [references/workspace-runners.md](references/workspace-runners.md).
- Multi-step workflows, `Effect.fn`, conditionals, and error recovery inside a pipeline: [references/declarative-workflows.md](references/declarative-workflows.md).
- Schemas, brands, validation, error mapping, discriminated unions, and `Match`: [references/schemas-errors-and-unions.md](references/schemas-errors-and-unions.md).

Always apply these rules:

- Use Effect operators for control flow. Retry with `Effect.retry` and a `Schedule`, bound waits with `Effect.timeout` or `Effect.timeoutOrElse`, and carry expected failures as typed errors. Don't write Promise retry loops, `try`/`catch` recovery, or `unknown` error plumbing next to Effect code.
- Run Effects only through a Workspace runner. The `no-direct-effect-runs` and `no-direct-next-effect-imports` Grit rules reject `Effect.run*` and direct `@deskohub/next-effect` imports in Workspace source.
- Typechecks run the `@effect/tsgo` diagnostics; the root `prepare` script patches TypeScript for them. The `multipleEffectProvide` diagnostic only flags chained `Effect.provide`. Compose independent Layer dependencies with one `Layer.provide(Layer.mergeAll(...))`.

When developer feedback changes a durable Effect convention, update the matching reference.
