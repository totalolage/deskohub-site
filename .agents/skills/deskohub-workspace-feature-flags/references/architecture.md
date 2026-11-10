# Workspace feature-flag architecture

PostHog is the source of truth for flag keys, variants, and payload types. Workspace commits its generated contract so builds don't need the management API or its credential, and builds never regenerate it.

## Sync the contract

After you change flags in PostHog, run:

```bash
bun turbo run feature-flags:sync --filter=deskohub-workspace
```

The task needs `POSTHOG_API_KEY`, `POSTHOG_API_HOST`, and `POSTHOG_PROJECT_ID`; supply them explicitly. `bun scripts/sync-posthog-feature-flags.ts --cli` reads definitions through `posthog-cli` instead and needs only `POSTHOG_PROJECT_ID`. The CLI path refuses to run unless the CLI points at project `204184`, named `Deskohub Workspace`. Don't gate the sync on any flag's rollout state; a flag's activation is PostHog data, not a contract precondition. Generation writes definitions and payload shapes, never live payload values.

## Runtime evaluation

`WorkspaceFeatureFlagService.Default` (`features/feature-flags/backend/workspace-feature-flag.service.ts`) first classifies each flag from its live management definition (`backend/feature-flag-evaluation-mode.server.ts`, cached with the `publicContent` profile):

- Constant off: inactive flags, and active flags without experience continuity that have at least one release group and roll every group out to 0%.
- Constant on: active flags with an unconditional 100% group (no properties, no group aggregation), unless the flag uses experience continuity, flag-level group aggregation, or variants. With `early_exit`, every earlier group must also roll out to 100%. An unset rollout counts as 100%.
- Request-dependent: everything else. A management read failure or missing management configuration makes every flag without an override request-dependent.

`getConstantEnabledValue` in `packages/posthog/src/feature-flags/definitions.ts` holds these rules.

`isEnabled` returns a constant directly. `constantValue` returns only a constant, as an `Option`, and never reads the request or calls PostHog. `evaluateFlags` returns constants locally only when every requested flag is constant. Never infer constancy from an evaluated value.

### One remote evaluation per request

Any other read goes through `evaluateRequestFlags` (`backend/request-flag-evaluation.server.ts`). It evaluates every contract flag that is neither constant nor overridden in one `/flags` request, whichever flag was asked for, and answers every later read of the request from that result:

- The subject is the consented PostHog visitor identity, or the fixed `deskohub-workspace:global-release` subject (with `sendFeatureFlagEvents: false`) before consent and for work that serves no visitor (`backend/subject.ts`).
- The evaluation is shared per request and subject, keyed by the request's headers object: the headers a Server Action, route, or HttpApi boundary captured (`CurrentWorkspaceRequestHeaders`), else Next's request headers, which are one object per request. Server Components, Server Actions, route handlers, and Effect layers of one request share it without React `cache`. A run outside any request (no captured headers and a visitor its boundary resolved, such as a task) shares it per build of `WorkspaceFeatureFlagService.Default`.
- An incomplete classification (definitions unavailable) adds flags to that one evaluation; it never fans out per gate.
- A consented visitor's evaluation uses the SDK's `evaluateFlags` snapshot, so reading a flag still records its `$feature_flag_called` event, once per flag and visitor per client. The global subject records none.

The global subject's result is the same for every anonymous visitor while no flag targets persons or groups, so each isolate keeps it in an Effect `Cache` keyed by subject id and sorted flag set: 60 seconds for a complete evaluation, 15 seconds for a failed one or one PostHog left incomplete (the Node SDK turns failed, timed-out, or quota-limited evaluations into missing flags, not errors). Identified visitors never use it. When a flag gains person or group targeting, drop this cache.

### Remote evaluation only in production

Previews, E2E runs, local development and tests share production's PostHog project and its flag-request quota, so only the production deployment evaluates flags remotely. `readRemoteEvaluationPolicy` (`backend/remote-evaluation-policy.server.ts`) maps the validated `env.VERCEL_ENV` through `byStage` (`shared/deployment/deployment-stage.ts`): `production` is `allowed`; `preview`, `development` and a missing stage are `disabled`. Vercel sets `VERCEL_ENV` at build and runtime, and the env schema rejects a missing or unknown value, so production can't be classified as anything else. The test bootstrap defaults it to `development`, so tests never call PostHog. Don't add a second notion of environment or a switch that re-enables remote evaluation outside production.

Under `disabled`, nothing on the server calls PostHog's `/flags`: every flag that would have gone remote reads as `false`, so its gate stays closed, and each such flag is logged once per isolate with code `feature_flags.remote_evaluation_disabled`. Outside production a flag is therefore on only when its live definition classifies it constant on, or when `POSTHOG_FEATURE_FLAG_OVERRIDES` turns it on. Classification still lists definitions through the management REST API there; that isn't billed as a flag request. A missing override never fails a build. When an E2E case or a local workflow needs a flag that isn't constant on, give it an override (below), never remote evaluation.

Public pages use this one adaptive path. Cache request-independent provider reads, such as calendar or media data, at their own boundaries. Don't build a parallel global page or separate global and request service layers; when a flag becomes targeted, the same service reads the request subject and Next.js makes the route dynamic.

Keep the package Node service a thin typed wrapper around one lazily created SDK client. A key-value lookup doesn't need its own Context service, Layer, or ManagedRuntime.

## Deployment-scoped overrides

`POSTHOG_FEATURE_FLAG_OVERRIDES` is an optional server-only JSON object of flag keys to booleans. Use it only for isolated development or protected-preview validation, never for rollout management or to change PostHog's stored definitions:

```env
POSTHOG_FEATURE_FLAG_OVERRIDES={"discount_codes":true}
```

Validation, in `features/feature-flags/feature-flag-overrides.schema.ts`:

- Malformed JSON and an invalid value for a contract key fail in every deployment.
- Values of keys outside the contract stay unvalidated. One Vercel Preview value serves every branch and may name a flag that a branch hasn't synced yet, so an unknown key must not fail a preview build.
- Production rejects any non-empty map.

Keep these schemas and their tests in the feature-flag module; `env.schema.ts` composes them. T3 Env's field dictionary drops cross-field Effect Struct checks, so the production check runs in the named final-schema composer `createEnvironmentSchema`. Keep a regression test on that integration path.

`resolveFeatureFlagOverrides` (`feature-flag-overrides.ts`) drops unknown keys and their values with a warning that names only the keys. Consumers read the resolved map from `postHogRuntimeConfig`, never the raw environment value. The map:

- applies once to the process-scoped Node client and also overrides constant classification;
- passes unchanged from the server layout to the consent-aware browser boundary, which replaces the complete override set after analytics initializes and clears persisted overrides when the map is absent;
- never comes from a request, cookie, header, URL, or visitor identity.

### Turn a flag on for one PR

Add a Vercel Preview `POSTHOG_FEATURE_FLAG_OVERRIDES` value scoped to the PR's Git branch on the Workspace project, holding the complete map the branch needs (the shared Preview keys plus the PR's flag), and redeploy the branch. A branch-scoped value replaces the shared Preview value for that branch only. Never edit the shared Preview value for one PR: it serves every preview and E2E run. For local development, set the variable in the app's local env file.

Don't initialize analytics before consent just to apply an override. Type browser override clients against `PostHogFeatureFlagOverrides<Definitions>` instead of casting to a record.

## Rollout inspection

Read a flag's enabled status separately from its release conditions. A disabled flag can still show a condition such as `100% of all users`; that's what would apply if it were enabled, not evidence that it's active.
