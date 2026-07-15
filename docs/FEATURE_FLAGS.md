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

The server evaluates this flag once with PostHog's Node SDK and a fixed public-site distinct ID, requesting only `meeting_room_page`. An unavailable, absent, or disabled flag fails closed and returns a 404 before page content or metadata is rendered. The React UI consumes the generated typed hook so an already-open page stays aligned with PostHog after hydration.

Configure these as global on/off release switches unless the implementation is updated to supply a stable visitor identity for targeted rollouts.

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
