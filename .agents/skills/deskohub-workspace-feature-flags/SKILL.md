---
name: deskohub-workspace-feature-flags
description: Implement or review Deskohub Workspace feature flags using the app-owned generated PostHog contract and request-subject-aware typed clients.
---

# Deskohub Workspace feature flags

Use the Workspace app-owned generated PostHog contract and request-subject-aware typed clients. Do not reuse the Boardgame Bar static flag constants.

Follow the architecture documented in [FEATURE_FLAGS.md](../../../docs/FEATURE_FLAGS.md). Update the generated contract through the documented sync workflow, keep flag evaluation fail-closed where the feature requires it, and update this skill when developer feedback changes a durable feature-flag convention.
