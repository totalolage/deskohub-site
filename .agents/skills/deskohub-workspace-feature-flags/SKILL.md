---
name: deskohub-workspace-feature-flags
description: Workspace PostHog feature flags, generated contracts, release subjects, and preview overrides.
---

# Deskohub Workspace feature flags

Use the Workspace app-owned generated PostHog contract and typed server client. Do not reuse the Boardgame Bar static flag constants.

Server consumers resolve `WorkspaceFeatureFlagService` from Effect Context. The default service classifies the current PostHog definition: boolean lookups return a provably constant value directly, while partial rollouts and conditions use the consented request subject. Whole-snapshot evaluation uses the fixed non-recording Workspace release subject only when every requested flag is constant. Classification must fail closed to request-aware evaluation when management configuration or definition loading is unavailable. Never infer this from an evaluated value. Keep public pages on one adaptive rendering path and cache their request-independent provider data separately; do not introduce parallel global and request layers or page implementations. The capability owns the process-scoped typed Node client; feature-specific services own fail-closed logging and fallback behavior. Do not import the Node client or release subject directly from feature code, and do not redeclare generated flag-key or package snapshot types.

Compose a feature-specific fail-closed lookup as `Effect.tapError` followed by
`Effect.orElseSucceed(() => false)`. Keep logging and fallback as peer
operators; do not nest a logging pipe inside `catch`. When a release gate
applies to only one reservation family, dispatch exhaustively by `kind` so
unrelated families do not even evaluate the gated lookup.

For boolean release gates, only `true` is enabled. Treat explicit `false` as
the ordinary off state without error logging. An omitted value means PostHog
did not evaluate the requested flag, such as when the flag is inactive; fail
that gate closed and log the missing flag as unavailable.

Keep the package Node service as a thin typed wrapper around one lazily created SDK client. A key/value lookup does not need its own nested Context service, Layer, or ManagedRuntime.

Read [the feature-flag architecture](references/architecture.md) for generation, runtime evaluation, subjects, and deployment-scoped overrides. Read [the PostHog package reference](references/posthog-package.md) when changing the shared generated client or typed feature-flag adapters. Keep flag evaluation fail-closed where the feature requires it, and update this skill when developer feedback changes a durable feature-flag convention.

Deployment-scoped overrides use the optional server-only `POSTHOG_FEATURE_FLAG_OVERRIDES` value, decoded against the generated Workspace contract. Only preview and development deployments may configure a non-empty map; production configuration must fail validation. Apply the map once to the process-scoped Node client and pass that identical typed map from the server layout to the consent-aware browser boundary. Never derive overrides from a request, cookie, header, URL, or visitor identity. After browser initialization, replace the complete override set and explicitly clear persisted overrides when the map is absent. Do not initialize PostHog before analytics consent merely to apply an override.

Keep feature-flag-specific environment schemas and their focused tests in the feature-flag module; the root environment schema should import and compose them. T3 Env's field dictionary drops cross-field Effect Struct checks, so apply deployment validation through a named final-schema composer and cover that integration path with a regression test. Type browser override clients directly against `PostHogFeatureFlagOverrides<Definitions>` instead of casting the typed map to an arbitrary record.

Keep the PostHog React provider at the localized application root so one context
wraps every client feature-flag consumer. Do not add page- or feature-local
providers. Consent-aware initialization and analytics rendering may suspend
independently inside that global provider so dynamic consent state does not gate
the application's cacheable navigation shells.

Use overrides only for isolated development or protected-preview validation, never for rollout management or mutation of PostHog's stored flag definitions. Safe example:

```env
POSTHOG_FEATURE_FLAG_OVERRIDES={"discount_codes":true}
```

When auditing rollout state, read PostHog's explicit flag status independently
from its release conditions. A disabled flag may still display a configured
condition such as `100% of all users`; that percentage describes the rollout
that would apply if the flag were enabled and is not evidence that the flag is
active.
