---
name: deskohub-workspace-feature-flags
description: Implement or review Deskohub Workspace feature flags using the app-owned generated PostHog contract and request-subject-aware typed clients.
---

# Deskohub Workspace feature flags

Use the Workspace app-owned generated PostHog contract and request-subject-aware typed clients. Do not reuse the Boardgame Bar static flag constants.

Server consumers resolve `WorkspaceFeatureFlagService` from Effect Context. The capability owns request-subject selection and the process-scoped typed Node client; feature-specific services own fail-closed logging and fallback behavior. Do not import the Node client or request-subject resolver directly from feature code, and do not redeclare generated flag-key or package snapshot types.

Keep the package Node service as a thin typed wrapper around one lazily created SDK client. A key/value lookup does not need its own nested Context service, Layer, or ManagedRuntime.

Follow the architecture documented in [FEATURE_FLAGS.md](../../../docs/FEATURE_FLAGS.md). Update the generated contract through the documented sync workflow, keep flag evaluation fail-closed where the feature requires it, and update this skill when developer feedback changes a durable feature-flag convention.
