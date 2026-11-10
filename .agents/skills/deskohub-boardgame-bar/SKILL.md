---
name: deskohub-boardgame-bar
description: Boardgame Bar, deskohub-boardgame-bar, bar.deskohub.cz, opening hours, Google Calendar webhook, table reservation, ChoiceQR, training-room request, contact form email, Resend, static feature flags, siteConstants, cache tags, Temporal polyfill.
---

# Deskohub Boardgame Bar

Business behavior lives in `apps/deskohub-boardgame-bar/docs`. Read the matching spec before changing customer or operator behavior.

- For opening-hours exceptions, the Google Calendar watch, and its cron, read [references/opening-hours.md](references/opening-hours.md).
- For table reservations and training-room requests, read [references/reservations.md](references/reservations.md).
- For email provider selection and sender addresses, read [references/email.md](references/email.md).

Paths below are relative to `apps/deskohub-boardgame-bar`.

## Feature flags

Release gates are static: `siteConstants.featureFlags` in `shared/utils/constants.ts`. Changing one needs a deployment. Gate at the page, primary action, or major presentation boundary. When you add a temporary flag, add a cleanup task.

## Development-only behavior

Detect development with `isDev` from `shared/utils/environment.ts`, not scattered environment checks. Never relax webhook authentication based on a browser-controlled value; on the client, `isDev` also trusts the hostname.

## Cache tags

Tag cached server functions with the helpers in `shared/utils/cache-tags.ts`, not ad hoc strings. Apply broad and entity-specific tags when callers need both invalidation scopes. After a mutation or an authenticated provider notification, invalidate only the affected tags.

## Temporal global

`shared/polyfills/temporal.ts` installs the `Temporal` global idempotently. `instrumentation.ts` loads it for the server and `app/rootLayout.tsx` loads it for static prerender, because Next.js skips instrumentation during `next build`. Feature modules use the global and never import the polyfill.
