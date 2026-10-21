# Workspace runners

Every Workspace Effect runs through one runner or boundary. Server runners live in `apps/deskohub-workspace/shared/backend/`: `workspace-effect.ts` (`runWorkspaceEffect`, `runWorkspaceEffectOrElse`, `defineWorkspaceTask`, `defineWorkspacePage`), `workspace-action.ts` (`defineWorkspaceAction`), and `workspace-route.ts` (`defineWorkspaceRoute`). The browser runner is `shared/browser/workspace-browser-effect.ts`.

## Actions and routes

- For a same-app UI operation that needs no addressable HTTP resource, use `defineWorkspaceAction` and validate input with its Standard Schema `schema`. Provide feature capabilities inside the handler. The action runtime owns request context, bot protection, failure mapping, the deadline, and telemetry. Don't make client components call app-owned endpoints just to reach server code.
- In a `"use server"` module, export an async bridge declared in that module, not the function the action factory returns, so Next assigns the Server Action identity. A passing production build doesn't prove the bridge works; cover it with an E2E test that invokes the action.
- For an addressable HTTP resource, use `defineWorkspaceRoute` and set `cancellation` explicitly. Use `"interrupt-on-disconnect"` for pure response generation and `"continue-after-disconnect"` only for side effects that must finish without the requester. Set `caller` too: `"service"` for a webhook, cron, or warehouse pull, whose work counts as unclassified agent traffic, and `"client"` for everything else, which classifies the request's own headers.
- Keep status codes and public messages out of domain and Layer errors. Before you return the route handler Effect, provide all capabilities and map the final error channel to `WorkspaceRouteFailure`, keeping the original error as `cause`. Map unexpected errors with `WorkspaceRouteFailure.internal(publicMessage)`.
- An Effect HTTP API served through `HttpRouter.toWebHandler` has its own runtime. Merge `WorkspaceObservabilityLive` into its Layer and pass `memoMap: workspaceMemoMap`, as `features/admin-cli/workspace-admin-api.server.ts` does. When a handler maps a failure to a cause-less public error, log the original cause first.

## Queue consumers

Define every Vercel Queue route with `defineQueueConsumer(operation, consume, redelivery)` from `shared/backend/queue/queue-consumer.ts`. It runs the task, logs a failure once with its cause through the censored logger, and hands the SDK only a `QueueDeliveryFailure` carrying the `retry` directive. The SDK `console.error`s a rethrown handler error outside censorship, so never let a raw cause escape a queue route.

- The consumer's `redelivery` classifies only its own lone typed failure: `QueueRedelivery.Never` acknowledges, `WithBackoff` redelivers after 60 s doubling to 15 min, `At` redelivers at a known instant (up to the 1 h visibility limit), and `Default` keeps the trigger's `retryAfterSeconds`.
- Only `VERCEL_ENV === "preview"` acknowledges a message whose database is gone (SQLSTATE class 28, 3D000, Neon endpoint not found) or that reached `previewQueueDeliveryLimit` deliveries. Elsewhere an unavailable database backs off and wins over any consumer classification, so nothing is dropped without one.

## Shared runtime

`NextEffect.make({ layer })` builds its Layer once per process, on the first run, and all server boundaries share it. Each run forks the runtime's memo map. Providing a Layer the runtime already built reuses its shared instance; any other Layer a handler provides with `Effect.provide` builds per run and never leaks between concurrent requests.

- Put only process-wide, finalizer-free capabilities in a runtime Layer. Keep per-request state (log annotations, request context, headers, abort signals) inside the run.
- Never dispose a runtime; serverless processes end without a shutdown hook. Flush telemetry with `scheduleWorkspaceTelemetryFlush` at request boundaries and `Effect.ensuring` in tasks, as `defineWorkspaceTask` does.
- Run work the response shouldn't wait for, such as analytics capture, with `runWorkspaceEffectAfterResponse(operation, effect)`. It schedules through Next's `after()` and logs, never raises, a scheduling failure.

## Fail-open runs

When a run must serve a fallback or react to any failure, such as a `"use cache"` function that calls `cacheLife({ expire: 0 })`, use `runWorkspaceEffectOrElse(operation, { failureCode, orElse })`. The runtime builds its Layer before entering the Effect, so `Effect.catchCause` or `Effect.onExit` inside the program can't see a runtime-build failure, and a Promise `.catch` after `runWorkspaceEffect` is the wrong tool. Make `failureCode` stable and low-cardinality. The function's JSDoc defines how `orElse`, interruption, and Next.js control flow interact.

## Browser runs

Client modules run Effects with `runWorkspaceBrowserEffect(operation, { signal })`. It's the only browser module allowed to import `@deskohub/next-effect`. It rejects like the server runner, rethrows Next.js control flow, and interrupts on `signal` abort.

- For an Effect that lives as long as a component, started in `useEffect` and stopped by aborting its `AbortController` in cleanup, use `runWorkspaceBrowserEffectUntilAbort(operation, signal)`. The abort is the expected end, so it settles the promise instead of rejecting with an interruption, and `void`ing the promise is safe. Strict Mode's double mount and every unmount take that path.
- The runner provides an empty `References.CurrentLoggers`, so browser `Effect.log*` output is discarded. Don't import Effect's `Logger` module in browser code, even as a named import; it adds about 20 KB gzip to every page's first load.
- Report a failure with `reportWorkspaceBrowserFailure(failureCode, cause)` from `shared/browser/workspace-browser-logs.ts`, run through the runner. It never fails, so `void` its promise on a fire-and-forget path. It records only the run's `operation` and `boundary`, the censored `failureCode`, an HTTP `status`, and an `errorType` from `classifyErrorType` in `shared/utils/log-classification.ts`.
- Never copy a raw `name`, `_tag`, or message into a browser record. `classifyErrorType` passes only an allowlist of built-in JavaScript and DOM error names and maps everything else, including Workspace tagged errors, to `unclassified`.
- For delivery and consent behavior of these records, see the `deskohub-workspace-account` skill's PostHog identity and privacy reference.
