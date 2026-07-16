# Caching Strategy

## Overview

The app uses Next.js cache components (`"use cache"`) with tag-based invalidation.

Key files:

- `shared/utils/cache-tags.ts` - tag namespace helpers
- `next.config.mjs` - enables `experimental.useCache`
- `app/api/webhooks/reservation/route.ts` - webhook-driven `revalidateTag(...)`

## Tag Namespaces

Current tag groups include:

- `cdn:*` for Cloudinary assets
- `api:*` for Dotypos-backed API data
- reservation/customer/table/menu-related tags via helpers in `dotyposTags`

## Pattern: Cached Fetch + Tags

```ts
export async function getGalleryImages() {
  "use cache";
  // applyCacheTags(...)
  // fetch and return
}
```

Use specific tags (`byId`) and broad tags (`all`) where appropriate.

## Pattern: Invalidate on Mutations/Webhooks

After data changes, invalidate affected tags with `revalidateTag(tag, "max")`.

Example from reservation webhook flow:

- `dotyposTags.reservation.all()`
- `dotyposTags.reservation.byId(reservationId)`
- `dotyposTags.reservation.byCustomer(customerId)`

## Configuration

`next.config.mjs`:

```js
experimental: {
  useCache: true,
}
```

## Practical Guidelines

1. Tag every cached function with stable, domain-level tags.
2. Revalidate only tags impacted by the mutation.
3. Keep tag naming consistent through helpers (avoid ad-hoc string literals).
4. Keep cache logic server-side.

## Build Cache Boundaries

The Workspace Vercel project has 12-hour Skew Protection enabled. Vercel injects
deployment-specific `NEXT_PUBLIC_VERCEL_*` values for each deployment, and
Turborepo's Next.js framework inference includes those values in the `build`
task hash. A full Next.js cache miss between deployments is therefore expected
and preserves the deployment-specific version information required by Skew
Protection.

The `i18n:compile` task is independent of those values. Its inputs are limited
to the Workspace message files and Inlang project configuration, so its task
configuration excludes `NEXT_PUBLIC_VERCEL_*` from framework inference. When
those inputs are unchanged, the generated Paraglide output can be restored from
the remote cache even though the Next.js build still runs.

This boundary is intentional: do not exclude deployment-specific variables
from the Workspace `build` task to obtain a full Next.js cache hit.

## Expected Build Impact

Necessary runtime-changing deployments should take approximately the same time
because the Next.js build and production PostHog source-map processing remain
enabled. Restoring the independent i18n output avoids a small amount of repeated
work, but does not promise a large reduction in per-build latency.

Recent production builds also created a Vercel build-cache archive of roughly
370 MB. That archive and PostHog source-map upload remain known costs for actual
builds and should be measured separately from Turbo task caching.

For live verification, compare Turbo task counts across deployments. Unchanged
i18n inputs should restore the `i18n:compile` output while the
deployment-specific Next.js build runs.
