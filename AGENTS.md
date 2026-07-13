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
- Keep `--force --archive=tgz` on that manual Vercel deploy; stale Vercel build/file caches have produced impossible TypeScript errors from older source during checkout E2E.
- Generate Drizzle migrations, journals, and snapshots with Drizzle tooling; do not hand-write migration metadata or journal entries.
- For conditional rendering with no else branch, use `{condition && <Component />}` instead of `{condition ? <Component /> : null}`.
- When mapping a small variant union to copy, icons, or similar values, use an inline object lookup instead of ternaries; keep one-use lookup objects inline.
- Do not hoist JSX `className` strings into local variables when they are used only once; inline them at the usage site.
- Do not hoist simple one-use literals or lookup objects to module scope; inline them where they are consumed.
- Keep Workspace production releases on the intentionally simple sequence: build a staged Vercel production deployment without assigning domains, run pending migrations against the production Neon branch, then promote the ready deployment. Do not introduce expand/contract migrations or database branch swapping unless explicitly requested.
- Cloudinary credentials in sibling app env files can target a different product environment; when an exact public ID returns 404, verify the full account tuple before changing image-rendering code.
- Before fixing a bug raised by review, add a regression test against the current implementation and confirm that it fails. Do not change production code for hypothetical states that the application cannot produce.
