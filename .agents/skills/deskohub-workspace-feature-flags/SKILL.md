---
name: deskohub-workspace-feature-flags
description: Workspace PostHog feature flags, release gates, generated flag contract, feature-flag sync, flag overrides, POSTHOG_FEATURE_FLAG_OVERRIDES, rollout status, @deskohub/posthog package.
---

# Deskohub Workspace feature flags

Read the reference for the task:

- Evaluation, constant-flag classification, deployment-scoped overrides, contract sync, or rollout inspection: [references/architecture.md](references/architecture.md).
- Changes to `@deskohub/posthog`, its generated API client, or its typed feature-flag adapters: [references/posthog-package.md](references/posthog-package.md).

## Always apply

- Use the Workspace generated contract in `apps/deskohub-workspace/features/feature-flags/generated/contract.ts`, not the Boardgame Bar static flag constants. Don't redeclare flag-key or snapshot types.
- Server consumers resolve `WorkspaceFeatureFlagService` from Effect Context. Feature code doesn't import the Node client (`backend/node.ts`) or the request subject (`backend/subject.ts`) directly. Feature-specific services own fail-closed logging and fallback.
- Compose a fail-closed lookup as `Effect.tapError` followed by `Effect.orElseSucceed(() => false)`, as peer operators. Don't nest a logging pipe inside `catch`.
- For a boolean release gate, only `true` is enabled. Explicit `false` is the ordinary off state; don't log it as an error. An omitted value means PostHog didn't evaluate the flag, for example because it's inactive: fail the gate closed and log the flag as unavailable.
- When a release gate applies to one reservation family, dispatch exhaustively by `kind` so other families never evaluate the lookup.
- Keep the one PostHog React provider in `app/[locale]/layout.tsx`. Don't add page- or feature-local providers. Consent-aware initialization and analytics rendering may suspend inside it so consent state doesn't gate cacheable navigation shells.
- Keep PostHog origins role-specific: `POSTHOG_API_HOST` is the server-only management and query origin, `POSTHOG_INGEST_HOST` is the direct server SDK and OTLP origin, and `NEXT_PUBLIC_POSTHOG_HOST` is the browser ingest proxy. Server clients never go through the public proxy.

## Page release gates

Memoize a page gate with React `cache` and provide the memoized lookup to the page's Effect consumers, so metadata, page content, and nested loaders such as advertised prices share one evaluation per render. `features/office/backend/office-reservation-feature-flag.server.ts` is the pattern.

React `cache` doesn't memoize inside a Server Action or route handler. There, evaluate a gate once per run (build its decision as one Layer, as `ReferralFeatureFlagRequest` does) and have helpers read the provided service, never re-evaluate. `WorkspaceFeatureFlagService` can't run in `proxy.ts`: its classification is a `"use cache"` function, which the proxy doesn't support.

A gate may read the request subject. On a Cache Components page, evaluate it inside the Suspense boundary after `connection()`, never in the component that builds the static shell; a shell-level read makes the route dynamic and breaks `instant = true`. Also check the gate in `generateMetadata`, so crawlers and a constant-off flag get a real 404 while browsers get the streamed not-found boundary.

Content that must be visible in the static HTML, such as the price list that fetch-only agents read, can't sit in a Suspense boundary: React puts resolved boundary content in a hidden container. Read its gates with `WorkspaceFeatureFlagService.constantValue` inside a `"use cache"` loader, which never reads the request. Keep a gate decided per visitor closed there, and stream the visitor's version in place of the shared one only while some gate varies. `features/pricing/backend/price-list.server.ts` is the pattern. Static output that describes a gate maps that value with `globalRelease` (`features/feature-flags/backend/global-release.ts`) to `on`, `undecided` or `off`, as `llms.txt` does for the site tools. `loadGlobalRelease` (`features/feature-flags/backend/global-release.server.ts`, cached with `minutes` so it stays in the App Shell) reads any flag this way; the site description names the office only while it's `on`.

A layout-level gate that mounts a component on every page wraps it in `GlobalReleaseGate` (`features/feature-flags/components/global-release-gate.tsx`). A constant flag is decided in the static shell, so cached pages need no function invocation; only an `undecided` flag falls back to the per-request gate after `connection()`.
