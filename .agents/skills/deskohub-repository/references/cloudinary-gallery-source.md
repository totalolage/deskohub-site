# Cloudinary gallery source

How `@deskohub/cloudinary` serves tag-based gallery photo lists to the
Workspace and Boardgame Bar applications.

## Data source and quota rationale

- Tag-based gallery lists come from Cloudinary's CDN-delivered resource lists
  (`https://res.cloudinary.com/<cloud>/image/list/<tag>.json`, delivery type
  `list`) through `CloudinaryService.listTaggedAssets`, reached from the apps
  only through `getGalleryImages`.
- Do not move gallery lists back to the Admin Search API. Every Search call
  spends the hourly Admin API quota. Prerenders, cache revalidations, and
  webhook refreshes multiply those calls, and an exhausted quota (HTTP 420)
  blanks galleries in every app sharing the account. Tag list requests are
  delivery requests and spend no Admin quota.
- Keep folder listing (avatar staging), lookups by public ID, uploads,
  renames, and deletes on the Admin and Upload APIs. Tag lists cannot express
  them.

## Signing

- The `list` delivery type is restricted on the account and must stay
  restricted. Never ask anyone to clear "Resource list" under the Restricted
  image types security setting.
- The service signs each list URL locally through the SDK's `cloudinary.url`
  with `type: "list"`, `format: "json"`, `sign_url: true`, and the API secret.
  A signed URL bypasses the restriction without exposing lists to anonymous
  clients.
- The signed URL, its `s--…--` signature segment, and the raw response body
  never enter logs, errors, or spans. Failures map to a fixed
  `CloudinarySearchError` without a cause, and HTTP client tracing is disabled
  for these requests because client spans record the full URL. Never print a
  signed list URL while diagnosing.
- `cloudinary.url` consumes its options object. Pass a fresh object on every
  call.

## Expression semantics

- The outer expression array is OR, each inner group is AND, and `!tag`
  excludes assets carrying that tag. The service fetches each distinct tag
  once (positive and excluded), combines the lists in memory, and sorts and
  applies `maxResults` in code.
- A group without a positive tag selects nothing: there is no list for "all
  images". Callers must not rely on empty or exclusion-only expressions to
  mean "everything".
- A 404 list means no asset carries the tag and yields an empty list. 5xx
  responses retry under the shared transient retry policy; each request is
  bounded by a 5-second timeout that fails with the typed error.

## Limits and field coverage

- Each list holds at most 1000 assets. Past that, the list silently
  truncates; split the tag before relying on larger galleries.
- Lists carry `public_id`, `version`, `format`, `width`, `height`, `type`,
  `created_at`, and `context.custom` (localized alt, caption, and detail).
  The service derives `secure_url` and `url` with the SDK. `asset_id`,
  `folder`, `tags`, and per-asset update time are absent. `sortBy:
  "updated_at"` falls back to creation time.

## Freshness

- Cloudinary caches each list JSON for 60 seconds and regenerates it at most
  once a minute.
- The Workspace Cloudinary webhook revalidates `cloudinaryTags.all()`
  immediately. A refetch inside the CDN minute can still read the previous
  list, so the Workspace gallery cache uses a bounded profile (5-minute
  revalidate, 1-day expiry) instead of `max`. The next background refresh
  corrects a list cached from a stale CDN copy. Keep both the webhook
  revalidation and the bounded profile.
- Failures cache an empty list with the short failure profile (expiry at the
  5-minute prerender threshold) so a provider outage never fails a prerender.
