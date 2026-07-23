---
name: deskohub-workspace-feature-flags
description: Implement or review Deskohub Workspace feature flags using the app-owned generated PostHog contract and request-subject-aware typed clients.
---

# Deskohub Workspace feature flags

Use the Workspace app-owned generated PostHog contract and request-subject-aware typed clients. Do not reuse the Boardgame Bar static flag constants.

Server consumers resolve `WorkspaceFeatureFlagService` from Effect Context. The capability owns request-subject selection and the process-scoped typed Node client; feature-specific services own fail-closed logging and fallback behavior. Do not import the Node client or request-subject resolver directly from feature code, and do not redeclare generated flag-key or package snapshot types.

Keep the package Node service as a thin typed wrapper around one lazily created SDK client. A key/value lookup does not need its own nested Context service, Layer, or ManagedRuntime.

Follow the architecture documented in [FEATURE_FLAGS.md](../../../docs/FEATURE_FLAGS.md). Update the generated contract through the documented sync workflow, keep flag evaluation fail-closed where the feature requires it, and update this skill when developer feedback changes a durable feature-flag convention.

Deployment-scoped overrides use the optional server-only `POSTHOG_FEATURE_FLAG_OVERRIDES` value, decoded against the generated Workspace contract. Only preview and development deployments may configure a non-empty map; production configuration must fail validation. Apply the map once to the process-scoped Node client and pass that identical typed map from the server layout to the consent-aware browser boundary. Never derive overrides from a request, cookie, header, URL, or visitor identity. After browser initialization, replace the complete override set and explicitly clear persisted overrides when the map is absent. Do not initialize PostHog before analytics consent merely to apply an override.

Use overrides only for isolated development or protected-preview validation, never for rollout management or mutation of PostHog's stored flag definitions. Safe example:

```env
POSTHOG_FEATURE_FLAG_OVERRIDES={"discount_codes":true}
```
