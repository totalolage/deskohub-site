# AGENTS

The role of this file is to describe common mistakes and confusion points that agents might encounter as they work in this project. If you ever encounter something in the project that surprises you, please alert the developer working with you and indicate that this is the case in the Agent.md file to help prevent future agents from having the same issue.

## Points

- For new Effect services, declare the service interface first, then define a `Context.Tag` class with static layer properties; do not introduce new `Effect.Service` classes. Preferred shape:

```ts
interface IFooService {
  readonly prop: Type;
}

export class FooService extends Context.Tag("FooService")<
  FooService,
  IFooService
>() {
  static Live = Layer.effect(this, implementation);
}
```

Use `Layer.effect(this, ...)` for effectful/fallible setup, `Layer.sync(this, ...)` for pure lazy construction, and `Layer.succeed(this, ...)` for already-created implementations or test fakes.
- Make heavy use of exploration and research subagents to make sure you are taking the correct approach
- Dotypos request/response debug logging can include Authorization headers, refresh tokens, bearer tokens, and token response bodies; do not enable, fetch, or quote those logs for production diagnostics without explicit redaction.
- Workspace/Dotypos application logging is globally censored/redacted, so local code should not strip useful log annotations purely for privacy unless a new uncensored sink is introduced.
- Workspace Paraglide output can be stale relative to `features/i18n/messages/*.json`; run `bun run i18n:compile` before trusting generated copy or updating assertions that depend on message text.
