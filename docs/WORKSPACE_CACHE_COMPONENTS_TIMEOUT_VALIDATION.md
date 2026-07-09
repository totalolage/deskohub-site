# Workspace Cache Components Timeout Validation

Date disabled: 2026-07-08

## Context

The workspace app had production Vercel runtime timeouts with successful `200`
responses, including checkout and Cloudinary-backed pages. Production logs also
showed Next Cache Components timer warnings during prerender for
`/en-US/checkout/order`.

`cacheComponents` was disabled in
`apps/deskohub-workspace/next.config.mjs` to test whether the Next/Vercel Cache
Components runtime was keeping post-response work alive until the 300 second
function timeout. The active `"use cache"` directives were also removed from
workspace cached functions, and the Cloudinary `cacheTag` call was removed with
them.

This was changed around the same time as Neon compute tuning, so database cold
start reductions must be treated as a confounder.

## What To Watch

Use the production Vercel project and PostHog production logs.

Primary signals:

- Count of `Vercel Runtime Timeout Error: Task timed out after 300 seconds`.
- Any timeout on `/en-US`, `/cs-CZ`, `/en-US/checkout/order`, or
  `/cs-CZ/checkout/order`.
- Next Cache Components timer warnings mentioning `PRERENDER`.
- Request duration distribution for the same routes.

Secondary signals:

- Cloudinary search duration and result count logs.
- PostHog log flush failures or unusually long post-response work.
- Checkout safe action transport errors captured as
  `workspace_safe_action_transport_error`.

## Validation Window

Compare at least 48 hours before and after the production deployment containing
this change. Prefer a full week if traffic is low.

Record:

- Deployment URL and commit SHA.
- Vercel timeout count before and after.
- Cache Components warning count before and after.
- Whether any remaining timeouts share a route, deployment, or action.

## Interpretation

Strong evidence disabling helped:

- Cache Components warnings stop.
- 300 second runtime timeouts stop or drop materially on the same traffic level.
- Cloudinary searches remain fast and no longer correlate with post-response
  timeout logs.

Weak or no evidence:

- Timeouts continue with the same route pattern.
- Warnings continue despite `cacheComponents: false`.
- Timeouts move to explicit slow backend work such as Dotypos, Google Calendar,
  or payment setup.

## Follow-up

If disabling helped, keep Cache Components off until the app can isolate cached
functions and verify a newer Next/Vercel runtime. Re-enable only in a preview
deployment first, then compare the same signals above.

If disabling did not help, prioritize bounding post-response tasks, reducing raw
Cloudinary log payloads, and capping external provider pagination and retries.
