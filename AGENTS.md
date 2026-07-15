# AGENTS

## **IMPORTANT INSTRUCTIONS:**
The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, or you are unsure how to deal with, alert the developer and indicate the sticking point. When developer clarifies, corrects, or steers you, **add a concise note here so future agents do not need the same reminder**.

## Points

- For new Effect V4 services, declare the service interface first, then define a `Context.Service` class with static layer properties; do not introduce `Effect.Service`, `Context.Tag`, or `Context.GenericTag`. Preferred shape:

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


- Use `Layer.effect(this, ...)` for effectful/fallible setup, `Layer.sync(this, ...)` for pure lazy construction, and `Layer.succeed(this, ...)` for already-created implementations or test fakes.
- Structure Effect service modules as top-down narratives. After imports, put the public interface and `Context.Service` declaration first, followed by the primary workflow, then progressively more concrete operations. A reader should be able to stop at any depth and still understand the behavior at that abstraction level. Split the module when implementation detail branches into separate concerns.
- Make every non-trivial Effect workflow declarative, including service, provider, repository, and complex domain implementations. Prefer `Effect.Do.pipe`, using `Effect.bind` for effectful steps, `Effect.let` for pure derived values, `Effect.tap` for observational effects, and a final `Effect.map` for the result. Continue this structure down through the abstraction layers until reaching simple leaf operations where direct code is clearer.
- Type the real operations in a declarative workflow to accept object arguments containing the named domain values they require, and pass those operations directly to `Effect.bind`, `Effect.let`, or `Effect.tap`. Do not add adapter functions merely to translate an `Effect.Do` accumulator into positional arguments. Preferred shape:

```ts
Effect.Do.pipe(
  Effect.bind("candidates", findDiscountCandidates),
  Effect.let("eligible", collectEligibleDiscounts),
  Effect.let("ordered", orderDiscounts),
  Effect.bind("quote", applyDiscounts),
  Effect.map(({ quote }) => quote),
);
```

- When a declarative Effect workflow starts from an existing object input, use `Effect.succeed(input).pipe(...)` and bind from that record instead of rebuilding its fields with `Effect.Do` and `Effect.let`.
- Use Effect Schema codecs and checks for runtime domain validation when the value has a schema; do not duplicate that validation with manual predicate chains.
- Use Effect Schema branding utilities for schema-backed branded values; do not hand-roll `unique symbol` brands.
- Annotate branded Effect schemas with a stable identifier and domain description.
- Use Effect Schema rather than Zod for new schema definitions.
- Use branded domain identifier types in contracts and error fields instead of plain strings.
- When mapping one error into a domain error, preserve the original error in the wrapping error's `cause` property; never discard it.

- Treat services, providers, repositories, and external clients as Effect capabilities. Supply them through Context and compose their implementations with Layers; never pass them as ordinary function arguments or dependency objects. Resolve capabilities while constructing the consuming service and close over them in its implementation so public service methods accept domain input only. A service's `Live` layer should require its dependencies from Context rather than hardwiring their live layers; provide those layers at the application composition boundary, and replace them with test layers in tests.
- Keep an Effect service's interface, Context service declaration, and live layer in its `*.service.ts` module. Put its mock layer in an adjacent `*.service.mock.ts` module and use `Layer.mock` for partial test implementations instead of declaring service mocks inline in tests.
- Represent service construction directly as an Effect when a factory function adds no behavior or reuse. Avoid `make*` functions that merely return a single Effect expression.
- Name public service operations with `Effect.fn("Service.operation")`. Do not wrap the whole named operation in a redundant `Effect.withSpan`; add explicit spans only for meaningful nested trace boundaries.
- Omit Effect options that merely restate defaults, such as unbounded concurrency when it is already the default. Specify options only when they change behavior or communicate an important constraint.
- Expose each feature's public service API through its `index.ts` barrel. Keep providers, repositories, intermediate candidates, and other implementation modules private so consumers cannot depend on source-specific concerns.
- Tests should import the declaration modules they exercise directly rather than importing through the feature barrel.
- Prefer declarative pipelines where they clarify multi-step behavior, but do not force trivial leaf calculations into `Effect.Do`. If a leaf becomes conditional or multi-stage, extract it into its own named declarative pipeline.
- Make heavy use of exploration and research subagents to make sure you are taking the correct approach
- Prefer the optimal domain structure over preserving an existing layout by default. If current placement is awkward, refactor toward the better boundary rather than bending new code around the old shape.
- Do not leave genuinely generic utility functions as one-off helpers in the first file that needs them. Before adding one, check whether an equivalent or related helper already exists in shared utilities and either reuse or extend it; otherwise place the new utility where future callers can reasonably share it.
- Names should describe the role or concept callers use, not hidden implementation details. Avoid names like `PrismaWorkspaceReservationRepository`, `ZodParsedCheckoutParams`, `ServerFetchedDisabledDates`, or `SortableResizableWorkspaceTable` unless the qualifier distinguishes real alternatives at the boundary; prefer `WorkspaceReservationRepository`, `checkoutParams`, `disabledDates`, and `WorkspaceTable`.
- For schema-backed values passed around as types, prefer Standard Schema V1 types over library-specific schema types. Do not expose Zod or Effect Schema details in names or public type shapes unless callers genuinely need that specific library API.
- Dotypos request/response debug logging can include Authorization headers, refresh tokens, bearer tokens, and token response bodies; do not enable, fetch, or quote those logs for production diagnostics without explicit redaction.
- Workspace/Dotypos application logging is globally censored/redacted, so local code should not strip useful log annotations purely for privacy unless a new uncensored sink is introduced.
- Workspace Cloudinary search logs can include large raw provider response annotations such as asset/provider metadata; avoid fetching or quoting full raw Cloudinary log payloads for production diagnostics, and prefer summarized fields like result count, public IDs, status, and error code.
- Do not use `console.*` for Workspace diagnostics; use `Effect.log*` inside the censored logging pipeline so logs reach analytics and redaction consistently.
- Workspace customer access codes have appeared in PostHog log annotations before; keep access-code-like keys globally censored and never quote observed values back to the user.
- Ad-hoc Workspace status/service scripts can still print raw reservation annotations such as customer access codes; avoid running them unless needed, and never quote those log lines back to the user.
- Workspace Paraglide output can be stale relative to `features/i18n/messages/*.json`; run `bun turbo i18n:compile --filter=deskohub-workspace` from the repository root before trusting generated copy or updating assertions that depend on message text.
- Workspace E2E secrets that are only available in Vercel, such as email provider API keys, are not pullable into local env by design; validate email delivery through Vercel/runtime/webhook evidence and validate body content with a fake email transport renderer.
- Workspace checkout E2E for current-code webhook validation must deploy a fresh manual Vercel CLI preview from the current working tree, assign `new.workspace.deskohub.cz` to that deployment, and then run through that alias; do not use whatever the alias already points to unless the user explicitly asks to test the already-live alias.
- Workspace BotID protection must be configured end to end: narrowly register the page paths that invoke protected Server Actions, keep the `withBotId` rewrites, and call server-side `checkBotId()` before mutation side effects. Do not use blanket `/*` client interception without matching server verification, and do not remove BotID as the final security posture when fixing its transport integration.
- Workspace browser E2E is automation and BotID will correctly reject it. The E2E deploy must set the explicit `WORKSPACE_E2E_BOTID_BYPASS=HUMAN` marker and the BotID service must honor it only outside Vercel production; never configure this marker on a normal preview or production deployment.
- Keep `--archive=tgz` on that manual Vercel deploy so the current working tree is uploaded as a single archive.
- Reservation hold cleanup must happen only through the per-reservation scheduled queue task, with the daily cron job as the recovery path; do not add inline cleanup, sweep, or terminal-payment cancellation fallbacks.
- Generate Drizzle migrations, journals, and snapshots with Drizzle tooling; do not hand-write migration metadata or journal entries.
- For conditional rendering with no else branch, use `{condition && <Component />}` instead of `{condition ? <Component /> : null}`.
- Match discriminated unions with explicit cases and an exhaustive terminator; do not use fallback branches that would silently accept a newly added variant.
- Use `Match.tag` for `_tag` variants; reserve `Match.when` for refinements on other fields.
- Use Effect tagged schema/type wrappers and their constructors to add `_tag`; do not declare or construct `_tag` manually.
- Workspace reservation families are discriminated by `_tag: "cowork" | "meeting-room"`; `entryTier` refines cowork reservations only and must never contain `"meeting-room"`.
- Define functions implemented with an Effect generator as `Effect.fn("descriptor")(function* (...) { ... })`; do not wrap `Effect.gen(function* (...) { ... })` in an arrow function.
- When mapping a small variant union to copy, icons, or similar values, use an inline object lookup instead of ternaries; keep one-use lookup objects inline.
- Do not hoist JSX `className` strings into local variables when they are used only once; inline them at the usage site.
- Do not hoist simple one-use literals or lookup objects to module scope; inline them where they are consumed.
- Keep Workspace production releases on the intentionally simple sequence: build a staged Vercel production deployment without assigning domains, run pending migrations against the production Neon branch, then promote the ready deployment. Do not introduce expand/contract migrations or database branch swapping unless explicitly requested.
- Cloudinary credentials in sibling app env files can target a different product environment; when an exact public ID returns 404, verify the full account tuple before changing image-rendering code.
- In this secondary worktree, `main` may already be checked out in the primary repository. After fetching, create the next feature branch directly from `origin/main` instead of trying to switch this worktree to `main`.
- In named Effect operations, do not add a scoped annotation for the entire input when the operation wrapper already annotates the same input fields individually.
- Reuse the Workspace timezone and Temporal schemas/formatters from `shared/utils/site-constants.ts` and `shared/utils/temporal.ts`; do not redeclare them inside feature modules.
- Before fixing a bug raised by review, add a regression test against the current implementation and confirm that it fails. Do not change production code for hypothetical states that the application cannot produce.
