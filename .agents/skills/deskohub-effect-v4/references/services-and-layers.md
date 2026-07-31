# Services and Layers

## Declare services

Declare the public interface first. Define the service with `Context.Service` and static Layer properties. Do not introduce `Effect.Service`, `Context.Tag`, or `Context.GenericTag`.

```ts
interface IFooService {
  readonly prop: Type;
}

export class FooService extends Context.Service<
  FooService,
  IFooService
>()("FooService") {
  static Live = Layer.effect(this, implementation);
}
```

Select the Layer constructor by setup behavior:

- Use `Layer.effect(this, ...)` for effectful or fallible setup.
- Use `Layer.sync(this, ...)` for pure lazy construction.
- Use `Layer.succeed(this, ...)` for an already-created implementation or test fake.

Represent service construction directly as an Effect when a factory adds no behavior or reuse. Do not add a `make*` function that merely returns one Effect expression.

## Structure modules

Write service modules as top-down narratives. After imports, place the public interface and `Context.Service` declaration first, then the primary workflow, then progressively more concrete operations. Split the module when implementation detail branches into a separate concern.

Place newly introduced private helper definitions below their callers so the primary workflow remains the module's entry point and implementation details unfold afterward. Keep a helper above when its inferred return type establishes a public contract there.

Keep the interface, Context service declaration, and live layer in the `*.service.ts` module. Put the mock layer in an adjacent `*.service.mock.ts` module and use `Layer.mock` for partial test implementations instead of inline test mocks.

## Model capabilities

Treat services, providers, repositories, and external clients as Effect capabilities. Supply them through Context and compose implementations with Layers; do not pass them as ordinary function arguments or dependency objects.

Use Effect's `HttpClient` capability for outbound HTTP. Provide the live transport with a `FetchHttpClient` Layer at the closest application adapter that owns the external operation, so unrelated upstream orchestration services do not inherit the low-level `HttpClient` requirement. Replace it with a Layer-provided client or fetch implementation in tests. Do not thread `fetch` functions through operation parameters as an ad hoc mocking seam.

Import HTTP modules as named namespaces from the `effect/unstable/http` barrel, for example `import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"`. Do not add per-module namespace imports such as `import * as HttpClient from "effect/unstable/http/HttpClient"` in handwritten code.

Resolve capabilities while constructing the consuming service and close over them in its implementation so public methods accept domain input only. Let a service's `Live` layer require its dependencies from Context. Provide live dependency layers at the application composition boundary and replace them with test layers in tests.

## Name and expose operations

Name public service operations with `Effect.fn("Service.operation")`. Do not wrap the entire named operation in a redundant `Effect.withSpan`; add explicit spans only for meaningful nested trace boundaries.

In a named Effect operation, do not add a scoped annotation for the entire input when the operation wrapper already annotates the same input fields individually.

Prefer explicit type annotations for constructed service-boundary and public
projection values. Reserve `satisfies` for configuration and other literals
whose narrow inferred type is intentionally retained.

Collection combinators such as `Effect.all` and `Effect.forEach` are sequential by default. When all collection items are independent and all results are required, prefer `Effect.all(items.map(operation), { concurrency: "inherit" })`. Use `Effect.forEach` when the workflow is intrinsically iterative. Do not manually fork and join fibers to obtain concurrency. Use a numeric limit only when the operation has a real local concurrency constraint.

Expose each feature's public service API through explicit named exports in its `index.ts` barrel; do not use wildcard exports. Keep providers, repositories, intermediate candidates, and other implementation modules private. In tests, import the declaration module under test directly rather than through the feature barrel.

## Adapt Next boundaries

For same-app UI operations that do not need an independently addressable HTTP resource, use `defineWorkspaceAction` and validate untrusted input with its Standard Schema boundary. Provide feature capabilities inside the handler so the shared action runtime owns execution, request context, bot protection, failure mapping, timeouts, and telemetry. Do not make client components construct requests to app-owned endpoints merely to call server code.

For independently addressable HTTP resources, use `defineWorkspaceRoute` and choose its request-disconnect cancellation policy explicitly. Interrupt pure response generation when the requester disconnects; continue after disconnect only for side effects that must finish independently of the response. Keep status codes and safe public messages out of reusable domain and Layer errors. Before returning the handler Effect, provide all feature capabilities and map the final expected error channel to `WorkspaceRouteFailure`, preserving the original error as `cause`.

Map unexpected internal route errors with `WorkspaceRouteFailure.internal(publicMessage)` so HTTP 500 construction stays on the boundary error class and call sites remain concise.
