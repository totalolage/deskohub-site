# Development Environment Utility

## Overview

The project uses a shared `isDev()` helper from `shared/utils/environment.ts` to gate development-only behavior.

## `isDev()` Behavior

`isDev()` returns `true` when any of the following is true:

- `NEXT_PUBLIC_NODE_ENV === "development"`
- `NEXT_PUBLIC_VERCEL_ENV === "development"`
- Browser hostname is local (`localhost`, `127.0.0.1`, `192.168.*`, `10.*`)

This supports server-side checks and local-network device testing.

## Webhook Test Panel

- Component: `features/reservation/components/webhook-test-panel.tsx`
- Visibility: rendered only when `isDev()` is `true`
- Endpoint tested: `/api/webhooks/reservation`
- Status scenarios: `created` (0), `confirmed` (5), `declined` (10)

## Security Note

- In development, webhook UUID validation is intentionally skipped (`shared/backend/utils/webhook.ts`).
- In non-development environments, webhook requests must include `?secret=<DOTYPOS_WEBHOOK_SECRET>`.

## Recommended Usage

```ts
import { isDev } from "@/shared/utils/environment";

if (isDev()) {
  // Dev-only diagnostics, previews, or test controls
}
```

Use this helper instead of scattered direct environment checks.
