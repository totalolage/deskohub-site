# Feature Flags

## Overview

The Boardgame Bar uses static, code-level flags, while Workspace uses PostHog for public release gates that need to change without a deployment.

## Workspace PostHog Flags

PostHog is the source of truth for Workspace flag keys, variants, and payloads. Workspace owns its checked-in generated contract and constructs typed React and Node clients from it using `@deskohub/posthog`. Run the Workspace `feature-flags:sync` task after changing flags in PostHog:

```sh
bun turbo run feature-flags:sync --filter=deskohub-workspace
```

Generation uses `POSTHOG_FEATURE_FLAGS_API_KEY`, `POSTHOG_HOST`, and `POSTHOG_PROJECT_ID`. The management key is only needed for generation; normal builds consume the checked-in contract without calling PostHog's management API.

Current runtime flags:

- `calendar_sales` — gates Workspace Calendar sale discovery and affirmation.
- `customer_discounts` — gates Workspace Dotypos customer discounts.
- `discount_codes` — gates Workspace discount-code resolution and affirmation.
- `meeting_room_page` — controls the Workspace Meeting Room page and its header link.
- `seating_map` — controls whether checkout status and paid-reservation emails include the assigned seating map.

The server evaluates flags through the app-owned `WorkspaceFeatureFlagService`, which wraps the package-owned typed Node service and resolves the current request subject. Server features must consume this Context capability instead of importing the Node client or subject resolver directly. Feature-specific services own their fail-closed logging and fallback behavior. The shared capability uses the consented PostHog visitor identity from the request when available. Before PostHog initializes, or without analytics consent, it evaluates with an explicit global-release subject and suppresses feature-flag access events so the fallback does not pollute visitor analytics. Unavailable, absent, or disabled release flags fail closed at their feature boundaries. React consumers can use the generated typed hook to stay aligned with PostHog after hydration.

The global fallback keeps release switches available on a visitor's first request. Targeted or percentage rollouts should account for the fact that a stable PostHog visitor identity is only available after consent and client initialization.

### Deployment-scoped overrides

Workspace can fix generated PostHog flag values for an isolated development or protected-preview deployment with one optional server environment variable:

```env
POSTHOG_FEATURE_FLAG_OVERRIDES={"discount_codes":true}
```

The value is decoded against the Workspace-owned generated contract. Unknown keys, malformed JSON, and values that do not match the generated flag type fail environment validation. Missing, empty, or `{}` configuration means no overrides.

Overrides are deployment-scoped and may be configured only when `VERCEL_ENV` is `preview` or `development`. A non-empty production configuration fails environment validation instead of being ignored. This mechanism is for isolated development and protected-preview validation, not rollout management; it never modifies PostHog's stored flag definitions or rollout state.

The process-scoped `posthog-node` client applies the fixed map once when its existing lazy singleton is created. Request-level overrides are forbidden: do not derive overrides from cookies, headers, URLs, visitor identity, or other request data, because mutating the shared Node client would affect unrelated requests.

The server layout serializes the same decoded typed map to the consent-aware analytics boundary. After analytics consent initializes `posthog-js`, the browser replaces its complete override map so hydrated hooks agree with server-rendered fallback values. When configuration is absent, the browser explicitly clears persisted overrides. PostHog is not initialized merely to apply an override before analytics consent.

## Boardgame Bar Static Flags

## Source of Truth

- File: `shared/utils/constants.ts`
- Object: `siteConstants.featureFlags`

Current flags:

- `boardGamesList`
- `boardroomReservations`
- `contactForm`
- `tableReservations`
- `gallery`
- `menuPdfDownload`

## Usage Pattern

Use `siteConstants.featureFlags` directly in server components, actions, and feature components.

```ts
import { siteConstants } from "@/shared/utils/constants";

if (siteConstants.featureFlags.contactForm) {
  // render or execute contact form behavior
}
```

## Behavior Notes

- Flags are evaluated at runtime from constants and deployed with code.
- Changing a flag value requires a code change and deployment.
- This is intentional for the current operational model (simple, predictable, low external dependency footprint).

## Adding a New Static Flag

1. Add the flag key in `siteConstants.featureFlags`.
2. Use a descriptive camelCase name.
3. Apply the flag at the feature boundary (page composition, major CTA blocks, or action entry points).
4. If temporary, add a cleanup task to remove stale flags.
