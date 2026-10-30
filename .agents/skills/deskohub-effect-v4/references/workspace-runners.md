# Workspace runners

Every Workspace Effect runs through one runner or boundary. Server runners live in `apps/deskohub-workspace/shared/backend/`: `workspace-effect.ts` (`runWorkspaceEffect`, `runWorkspaceEffectOrElse`, `defineWorkspaceTask`), `workspace-action.ts` (`defineWorkspaceAction`), `workspace-route.ts` (`defineWorkspaceRoute`), and `service-route.ts` (`defineWorkspaceCron`, `defineWebhookRoute`). The browser runner is `shared/browser/workspace-browser-effect.ts`.

## Actions and routes

- For a same-app UI operation that needs no addressable HTTP resource, use `defineWorkspaceAction` and validate input with its Standard Schema `schema`. Provide feature capabilities inside the handler. The action runtime owns request context, bot protection, failure mapping, the deadline, and telemetry. Don't make client components call app-owned endpoints just to reach server code.
- An action's `serverError` is always copy in the action's locale. A `PublicSafeActionError` keeps its message; the runtime words a timeout with `failureCopy.timeout`, any other failure with `failureCopy.unexpected` (defects and a runtime that couldn't start included), and a typed failure the handler didn't make public with `fallback` when the action sets one. `failureCopy` defaults to the customer catalog; an administration area passes its catalog's pair once per area. Don't map a handler's leftover failures to a fixed public error by hand; set `fallback`. Return an outcome the client acts on, such as a refusal reason, as result data, never as the `serverError` text.
- An Admin UI operator action uses `defineAdministrationAction`, which builds on `defineWorkspaceAction`, and an Admin UI page query uses `runAdministrationPage`; see the `deskohub-workspace-administration` skill's dashboard reference.
- In a `"use server"` module, export an async bridge declared in that module, not the function the action factory returns, so Next assigns the Server Action identity. A passing production build doesn't prove the bridge works; cover it with an E2E test that invokes the action.
- For an addressable HTTP resource, use `defineWorkspaceRoute` and set `cancellation` explicitly. Use `"interrupt-on-disconnect"` for pure response generation and `"continue-after-disconnect"` only for side effects that must finish without the requester. Set `caller` too: `"service"` for a webhook, cron, or warehouse pull, whose work counts as unclassified agent traffic, and `"client"` for everything else, which classifies the request's own headers.
- Define a Vercel Cron route with `defineWorkspaceCron({ operation, failureMessage, input, run })`. It checks `CRON_SECRET` in constant time (development runs without one), answers 401 as a rejected route failure, logs the start and finish with `input` and the summary, answers the summary as JSON, and maps a job failure to `WorkspaceRouteFailure.internal(failureMessage)`. Provide the job's Layers inside `run`. Every path in `vercel.json` `crons` is covered by `app/api/cron/workspace/authorization.test.ts`.
- Define a provider webhook route with `defineWebhookRoute({ operation, failureMessage }, handle)`. `handle` succeeds with a receipt (`status`, `reason`) or fails with a `WebhookRefusal` whose `WebhookDisposition` is `declined` (202, the provider stops retrying), `rejected` (400 or 401), or `retry` (500 plus a retry warning), logged at the disposition's severity. Classify each provider's errors in a table beside the Workspace service that owns them, typed `satisfies Record<ErrorCode, WebhookDisposition>` and pinned by a colocated test that runs every code through `defineWebhookRoute`, as `nexi-webhook-disposition.ts` does. A verifier from a shared package keeps its errors there; its Workspace table sits with the feature the webhook serves, as `features/gallery/backend/cloudinary-webhook-disposition.ts` does. Choose each disposition for the provider's retry behavior: a Nexi token mismatch is declined so Nexi stops retrying it.
- Keep status codes and public messages out of domain and Layer errors. Before you return the route handler Effect, provide all capabilities and map the final error channel to `WorkspaceRouteFailure`, keeping the original error as `cause`. Map unexpected errors with `WorkspaceRouteFailure.internal(publicMessage)`.
- An Effect HTTP API served through `HttpRouter.toWebHandler` has its own runtime. Merge `WorkspaceObservabilityLive` into its Layer and pass `memoMap: workspaceMemoMap`, as `features/admin-cli/workspace-admin-api.server.ts` does. When a handler maps a failure to a cause-less public error, log the original cause first.

## Queue topics

Define each Vercel Queue topic once with `defineQueueTopic({ topic, label, message, publish, retention })` from `shared/backend/queue/queue-topic.ts`, next to the service that publishes it. `message` is the payload's Standard Schema. `publish(input)` returns the wire `message` and its idempotency `key`, plus an optional per-message `delay` or `retention`; the key may use input fields the message omits.

- `topic.publish(input)` requires the `QueuePublisher` capability (`shared/backend/queue/queue-publisher.ts`). Its `Default` sends through `@vercel/queue` and is the one place a `DuplicateMessageError` becomes a `duplicate` success. A publishing service resolves `QueuePublisher` in its `Default` and provides `QueuePublisher.Default` in its `Live`. Tests provide `makeMemoryQueue().layer` or `unavailableQueue()` from `memory-queue.test-utils.ts`.
- A route is `export const POST = topic.consume(operation, handle, redelivery)`. It decodes the message, logs `<label> queue message ignored: invalid payload` and acknowledges one that doesn't decode, and hands `handle` the decoded message.
- Keep the route's queue trigger literal in `vercel.json`; `vercel.test.ts` checks that every topic has exactly one trigger, on `app/api/queues/workspace/<topic without workspace->/route.ts`. Add a new topic to that test.

## Queue consumers

`topic.consume` is built on `defineQueueConsumer(operation, consume, redelivery)` from `shared/backend/queue/queue-consumer.ts`. It runs the task, logs a failure once with its cause through the censored logger, and hands the SDK only a `QueueDeliveryFailure` carrying the `retry` directive. The SDK `console.error`s a rethrown handler error outside censorship, so never let a raw cause escape a queue route.

- The consumer's `redelivery` classifies only its own lone typed failure: `QueueRedelivery.Never` acknowledges, `WithBackoff` redelivers after 60 s doubling to 15 min, `At` redelivers at a known instant (up to the 1 h visibility limit), and `Default` keeps the trigger's `retryAfterSeconds`.
- Only `VERCEL_ENV === "preview"` acknowledges a message whose database is gone (SQLSTATE class 28, 3D000, Neon endpoint not found) or that reached `previewQueueDeliveryLimit` deliveries. Elsewhere an unavailable database backs off and wins over any consumer classification, so nothing is dropped without one.

## Shared runtime

`NextEffect.make({ layer })` builds its Layer once per process, on the first run, and all server boundaries share it. Each run forks the runtime's memo map. Providing a Layer the runtime already built reuses its shared instance; any other Layer a handler provides with `Effect.provide` builds per run and never leaks between concurrent requests.

- Put only process-wide, finalizer-free capabilities in a runtime Layer. Keep per-request state (log annotations, request context, headers, abort signals) inside the run.
- Never dispose a runtime; serverless processes end without a shutdown hook. Flush telemetry with `scheduleWorkspaceTelemetryFlush` at request boundaries and `Effect.ensuring` in tasks, as `defineWorkspaceTask` does.
- Run work the response shouldn't wait for, such as analytics capture, with `runWorkspaceEffectAfterResponse(operation, effect)`. It schedules through Next's `after()` and logs, never raises, a scheduling failure.

## Fail-open runs

A `"use cache"` function runs its load with `readSharedSnapshot(operation, load, policy)` from `shared/backend/shared-snapshot.ts` and keeps the directive itself. The policy gives the `complete` outcome, an optional `incomplete` one picked by `when`, and an optional `failure` fallback, each with its own `cacheLife` lifetime and tags. Without `failure`, a failure rejects unshared. Any rejection (a failure without a fallback, an interruption, Next.js control flow, or a throwing `cacheLife`) rejects unchanged with `{ expire: 0 }`, because a remote cache handler still receives an entry whose render errored. Recovery that only some failures get, such as a typed definitions failure that degrades to fewer values, stays inside the load and returns a value `incomplete` recognizes. `shared/testing/next-cache-recorder.test-utils.ts` records the lifetimes and tags a loader sets; pin them with it.

Outside `"use cache"`, when a run must serve a fallback or react to any failure, use `runWorkspaceEffectOrElse(operation, { failureCode, orElse })`. The runtime builds its Layer before entering the Effect, so `Effect.catchCause` or `Effect.onExit` inside the program can't see a runtime-build failure, and a Promise `.catch` after `runWorkspaceEffect` is the wrong tool for recovery: it also catches interruption and Next.js control flow. `readSharedSnapshot`'s own `.catch` only expires the entry and rethrows. Make `failureCode` stable and low-cardinality. The function's JSDoc defines how `orElse`, interruption, and Next.js control flow interact.

Inside a program, recover a non-blocking step from any failure, defects included, with `catchRecoverableCause` (`workspace-effect.ts`). It lets interruption and Next.js control flow propagate, which a bare `Effect.catchCause` would swallow; `isRecoverableCause` is the same test for a hand-written handler.

## E2E runs

E2E code that runs an Effect outside a case or fixture runtime uses the edge in `apps/deskohub-workspace/e2e/`. Don't add another `Effect.run*` call for it.

- `runE2EEffect(effect, telemetry)` (`telemetry-runtime.ts`) runs a whole E2E run with the trace export, shuts the exporter down, and resolves with the run's `Exit`. `scripts/workspace-e2e.ts` uses it.
- `runUntracedE2EEffect(effect, { signal })` (`effect-edge.ts`) runs everything else without a tracer, such as the argv `Runner` in `runtime.ts`.
- Both reject exactly like `Effect.runPromise`. A run whose `signal` aborts before it settles rejects as soon as the signal aborts, with the signal's reason or an `AbortError` without one, even when the run recovers from the interrupt or a failing finalizer replaced it in the cause. The run's interruption and finalizers finish in the background, so a stuck Playwright cleanup can't hold up cancellation. An already aborted signal rejects with its reason as is before the run starts. `effect-edge.test.ts` pins this.

## Browser runs

Client modules run Effects with `runWorkspaceBrowserEffect(operation, { signal })`. It's the only browser module allowed to import `@deskohub/next-effect`. It rejects like the server runner, rethrows Next.js control flow, and interrupts on `signal` abort.

- For an Effect that lives as long as a component, started in `useEffect` and stopped by aborting its `AbortController` in cleanup, use `runWorkspaceBrowserEffectUntilAbort(operation, signal)`. The abort is the expected end, so it settles the promise instead of rejecting with an interruption, and `void`ing the promise is safe. Strict Mode's double mount and every unmount take that path.
- In client modules every page loads (consent, tag manager, routing, log classification), write type guards in plain TypeScript (`typeof`, `in`) instead of importing `Predicate` or `Option` for a single check. Keep Effect where it carries control flow, such as Schema decoding, Effect programs, and `Match` over tagged unions.
- The runner provides an empty `References.CurrentLoggers`, so browser `Effect.log*` output is discarded. Don't import Effect's `Logger` module in browser code, even as a named import; it adds about 20 KB gzip to every page's first load.
- Report a failure with `reportWorkspaceBrowserFailure(failureCode, cause)` from `shared/browser/workspace-browser-logs.ts`, run through the runner. It never fails, so `void` its promise on a fire-and-forget path. It records only the run's `operation` and `boundary`, the censored `failureCode`, an HTTP `status`, and an `errorType` from `classifyErrorType` in `shared/utils/log-classification.ts`.
- Never copy a raw `name`, `_tag`, or message into a browser record. `classifyErrorType` passes only an allowlist of built-in JavaScript and DOM error names and maps everything else, including Workspace tagged errors, to `unclassified`.
- For delivery and consent behavior of these records, see the `deskohub-workspace-account` skill's PostHog identity and privacy reference.
