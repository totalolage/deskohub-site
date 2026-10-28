# Services and Layers

## Declare services

Declare the public interface first, then the service with `Context.Service` and static Layer properties. V4 has no `Effect.Service`, `Context.Tag`, or `Context.GenericTag`.

```ts
interface IFooService {
  readonly prop: Type;
}

export class FooService extends Context.Service<
  FooService,
  IFooService
>()("FooService") {
  static Default = Layer.effect(this, implementation);
}
```

Choose the Layer constructor by setup behavior:

- `Layer.effect(this, ...)` for effectful or fallible setup.
- `Layer.sync(this, ...)` for pure lazy construction.
- `Layer.succeed(this, ...)` for an existing implementation or a test fake.

Name the default implementation `Default`, even when it still requires dependencies from Context. When a standard fully wired production composition exists, expose it as static `Live` on the same class, not in a separate runtime module. This applies to every Context capability, including repositories and configuration. The `no-standalone-capability-layers` Grit rule rejects standalone `FooDefault` or `FooLive` constants.

When a runtime that can't load application environment modules must still import the capability, keep `Live` on the class and lazily load an environment-bound factory named for construction, such as `makeFooLayer`. See `accounting-snapshot-key.service.ts`.

Write service construction directly as an Effect. Add a `make*` function only when it adds behavior or reuse.

## Lay out modules

- Write a service module top-down: imports, public interface, `Context.Service` declaration, primary workflow, then progressively more concrete operations. Place new private helpers below their callers, unless a helper's inferred return type defines a public contract above.
- Split the module when a detail becomes a separate concern.
- Keep the interface, service declaration, and live Layer in `*.service.ts`. Put the mock Layer in an adjacent `*.service.mock.ts` and build partial fakes with `Layer.mock`.
- Expose a feature's public service API through explicit named exports in its `index.ts` barrel. Keep providers, repositories, and other implementation modules private. In tests, import the module under test directly, not through the barrel. The `no-wildcard-reexport` Grit rule rejects `export *` in Workspace source.

## Model capabilities

Treat services, providers, repositories, and external clients as Effect capabilities. Supply them through Context and compose them with Layers, never as function arguments or dependency objects.

- Resolve capabilities while you construct the consuming service, and close over them so public methods take domain input only.
- Let `Default` require dependencies from Context. Provide live dependencies in `Live` and swap in test Layers in tests.
- Use Effect's `HttpClient` for outbound HTTP. Provide the `FetchHttpClient` Layer at the closest adapter that owns the external call, so upstream services don't inherit the `HttpClient` requirement. In tests, provide a test client or fetch through a Layer instead of passing `fetch` as a parameter.
- Import unstable modules as namespaces from their barrel: `import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"` or `import { SqlError } from "effect/unstable/sql"`. Don't deep-import paths such as `effect/unstable/http/HttpClient`.

## Call external providers

- Bound every outbound request with a timeout that fails with the capability's typed error. Pass the `Effect.tryPromise` abort signal to promise-based SDKs so a timeout or interruption cancels the request.
- Retry idempotent reads on Unavailable failures. Retry a write only when the provider honors a stable idempotency key or an `If-Match` precondition. Otherwise retry only failures that prove nothing was applied, such as 429 or an empty creation response. Keep each operation's retry ceiling in one private table in the provider package, guarded by a test that pins the table and the request counts.
- When a provider rejects a cached credential with 401, invalidate the cached credential.
- Keep the original error as `cause` unless it carries request bodies, credentials, or personal data. Then strip those parts and log only tags, identifiers, status codes, and field names.

### Report provider outcomes

A provider package's errors are part of its port, not its transport. Every provider failure is one of three tags, named `<Prefix><Outcome>`, where the prefix is the service class name without `Service` (`DotyposService` → `Dotypos`):

- `<Prefix>Unavailable`: the provider could not serve the request and nothing was applied. A later attempt can succeed.
- `<Prefix>Rejected`: the provider refused, or answered unusably in a way a retry would repeat. Nothing was applied.
- `<Prefix>Uncertain`: a write may have been applied. Only writes raise it; read signatures exclude it. The caller settles before acting, by rereading, replaying with the same key, or reconciling.

Rules:

- Each tag carries `operation` (the public operation), a closed `reason` literal, and diagnostic fields: `request`, `httpStatus`, `message`, `cause`. Branch on the tag. Use `reason` only for diagnostics and for the rare caller that needs a cause, such as honoring a rate limit. `httpStatus` is for logs only: apps log it through the provider's failure log fields, and the `no-provider-status-branching` Grit rule rejects any other read in app code.
- Provider facts that callers act on get their own tag, `<Prefix><Fact>`, such as `DotyposVersionConflict`. Business results, such as a payment state or an already-confirmed reservation, are success values.
- A lookup whose caller gives absence a meaning returns `Option`. A list returns empty. Any other absence is `<Prefix>Rejected` with reason `not-found`.
- A write that got a 2xx with an unreadable body is `<Prefix>Uncertain` with reason `invalid-response`. A read with an unreadable body is `<Prefix>Rejected`.
- A surfaced failure means the package's own retries are spent. Callers retry at a coarser grain: a queue, a job, or a user action.
- Uncertainty is sticky within one call. Once an attempt of a replayed write was uncertain, the call fails `<Prefix>Uncertain` unless it succeeds.
- Export one stable machine code per tag (`<prefix>-unavailable`, …) and a log-fields helper. Failure codes and log annotations use these, not HTTP statuses.
- Export the read, write and conditional-write unions (`<Prefix>ReadFailure`, `<Prefix>WriteFailure`, `<Prefix>ConditionalWriteFailure`) and annotate with them instead of listing tags.
- Only the provider package and tests construct its outcome classes. Application conditions get application-owned errors. The `no-borrowed-provider-outcomes` Grit rule enforces this.
- Each provider package keeps a colocated `errors.test.ts` with the type assertions: the tags are prefixed, reads exclude `Uncertain`, and the codes are total. Its service test holds the table-driven classification test over its fake transport.

## Name and run operations

- Name public service operations with `Effect.fn("Service.operation")`. It already creates the span; add `Effect.withSpan` only for a meaningful nested boundary. Don't add a scoped annotation for the whole input when the wrapper already annotates its fields.
- Annotate the type of constructed service-boundary and public projection values. Reserve `satisfies` for configuration and other literals whose narrow inferred type you want to keep.
- `Effect.all` and `Effect.forEach` run sequentially by default. For independent items whose results you all need, use `Effect.all(items.map(operation), { concurrency: "inherit" })`. `"inherit"` is unbounded unless a caller sets `Effect.withConcurrency`. Use `Effect.forEach` for intrinsically iterative work, a numeric limit only for a real local constraint, and never fork and join fibers by hand for concurrency. Inside a Workspace transaction everything runs on one connection: state no concurrency there, not even `"inherit"` ([workspace-transactions.md](workspace-transactions.md)).
