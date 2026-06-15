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
