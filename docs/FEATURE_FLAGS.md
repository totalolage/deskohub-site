# Feature Flags

## Overview

This project currently uses static, code-level feature flags defined in `shared/utils/constants.ts` under `siteConstants.featureFlags`.

There is no active Statsig/Edge Config runtime integration in the current codebase.

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

## Adding a New Flag

1. Add the flag key in `siteConstants.featureFlags`.
2. Use a descriptive camelCase name.
3. Apply the flag at the feature boundary (page composition, major CTA blocks, or action entry points).
4. If temporary, add a cleanup task to remove stale flags.
