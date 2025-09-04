# Caching Strategy with Next.js 15 'use cache' Directive

## Overview

This application uses Next.js 15's new `use cache` directive for efficient server-side caching. This approach replaces the older `unstable_cache` API with a cleaner, more ergonomic solution.

## Architecture

### Cache Tags System (`/shared/utils/cache-tags.ts`)

Our cache tag system uses simple, namespace-based tags for granular cache invalidation:

```typescript
// Example usage in a cached function
export async function getCachedData() {
  "use cache";
  
  // Apply cache tags for invalidation
  applyCacheTags(
    dotyposTags.reservation.all(),
    dotyposTags.reservation.byId(id)
  );
  
  // Fetch and return data
}
```

### Namespaces

- `cdn:` - Cloudinary images and assets
- `api:` - Dotypos API data
- `res:` - Reservations
- `cust:` - Customers
- `tbl:` - Tables
- `menu:` - Menu items and categories

## Implementation Patterns

### 1. Simple Cached Functions

```typescript
export async function getGalleryImages(options) {
  "use cache";
  
  // Apply relevant cache tags
  cloudinaryTags.apply();
  
  // Fetch and return data
  return fetchImages(options);
}
```

### 2. Cached Effect-based Services

For Effect-based services, create wrapper functions:

```typescript
export async function getCachedReservation(id: string) {
  "use cache";
  
  dotyposTags.reservation.apply(id);
  
  return Effect.runPromise(
    Effect.gen(function* () {
      const client = yield* DotyposClient;
      return yield* client.getReservation(id);
    }).pipe(Effect.provide(DotyposClientLive))
  );
}
```

### 3. Data-Driven Tagging

Tag cache entries based on fetched data:

```typescript
export async function getPost(id: string) {
  "use cache";
  
  const post = await fetchPost(id);
  
  // Tag with data-driven tags after fetching
  tagWithData(post, p => [
    `post:${p.id}`,
    `author:${p.authorId}`,
    `category:${p.categoryId}`
  ]);
  
  return post;
}
```

## Cache Invalidation

### Webhook-Based Invalidation

Webhooks trigger cache invalidation for specific tags:

```typescript
// In webhook handler
import { revalidateTag } from "next/cache";

export async function POST(request: Request) {
  // Process webhook
  
  // Invalidate relevant caches
  revalidateTag(dotyposTags.menu.all());
  
  return NextResponse.json({ success: true });
}
```

### On-Demand Invalidation

After mutations, invalidate affected caches:

```typescript
export async function updateReservation(id: string, data: UpdateData) {
  // Update in database
  await updateInDB(id, data);
  
  // Invalidate cache
  revalidateTag(dotyposTags.reservation.byId(id));
}
```

## Configuration

### Next.js Configuration (`next.config.mjs`)

```javascript
const nextConfig = {
  experimental: {
    cacheComponents: true, // Enable 'use cache' directive
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};
```

### TypeScript Configuration

The `.next/types/validator.ts` file is excluded from type checking due to a Next.js canary type generation issue that doesn't affect runtime.

## Best Practices

1. **Use Meaningful Tag Names**: Tags should clearly indicate what data they represent
2. **Apply Tags Early**: Call `applyCacheTags()` at the beginning of cached functions
3. **Granular Tagging**: Use specific tags (e.g., `res:123`) alongside general ones (e.g., `res:all`)
4. **Data-Driven Tags**: Use `tagWithData()` helper for dynamic tagging based on fetched data
5. **Consistent Namespaces**: Always use defined namespaces to avoid tag collisions

## Migration from `unstable_cache`

### Before (unstable_cache)
```typescript
import { unstable_cache as cache } from "next/cache";

const cached = cache(
  async () => fetchData(),
  ['cache-key'],
  { tags: ['tag1', 'tag2'] }
);
```

### After (use cache)
```typescript
export async function getData() {
  "use cache";
  
  applyCacheTags('tag1', 'tag2');
  
  return fetchData();
}
```

## Performance Benefits

- **Simpler Code**: No wrapper functions or manual cache keys
- **Automatic Key Generation**: Based on function arguments and build ID
- **Better Type Safety**: Direct function calls instead of wrapped callbacks
- **Granular Invalidation**: Precise control over what gets refreshed

## Limitations

- Server-side only (not for client components)
- Return values must be serializable
- Cannot use request-time APIs (`cookies()`, `headers()`) inside cached functions
- Default TTL is 15 minutes (configurable with `cacheLife`)

## Future Improvements

As Next.js 15 stabilizes, we can:
1. Add `cacheLife` configuration for custom TTLs
2. Implement cache warming strategies
3. Add cache hit/miss monitoring
4. Create cache invalidation queues for batch operations