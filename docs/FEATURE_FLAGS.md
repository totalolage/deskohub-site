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

- `meeting_room_page` — controls the Workspace Meeting Room page and its header link.
- `seating_map` — controls whether checkout status and paid-reservation emails include the assigned seating map.

The server evaluates flags through the package-owned typed Node service. It uses the consented PostHog visitor identity from the request when available. Before PostHog initializes, or without analytics consent, it evaluates with an explicit global-release subject and suppresses feature-flag access events so the fallback does not pollute visitor analytics. Unavailable, absent, or disabled release flags fail closed at their feature boundaries. React consumers can use the generated typed hook to stay aligned with PostHog after hydration.

The global fallback keeps release switches available on a visitor's first request. Targeted or percentage rollouts should account for the fact that a stable PostHog visitor identity is only available after consent and client initialization.

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
