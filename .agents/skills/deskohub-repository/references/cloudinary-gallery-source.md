# Cloudinary gallery source

Workspace and Boardgame Bar get tag-based gallery lists through `getGalleryImages` (`@deskohub/cloudinary/server`), which calls `CloudinaryService.listTaggedAssets`. The lister in `packages/cloudinary/src/tag-list.ts` reads Cloudinary's CDN tag lists (`image/list/<tag>.json`).

## Admin API quota

- Keep gallery lists off the Admin Search API. Tag lists are delivery requests and spend no Admin quota.
- The hourly Admin API quota is shared by every app on the Cloudinary account and by preview E2E runs. Prerenders, cache revalidations, webhook refreshes, and E2E bursts such as avatar uploads and account deletions multiply Admin calls. An exhausted quota returns HTTP 420 and fails every Admin call until the window resets.
- Keep folder listing, lookups by public ID, uploads, renames, and deletes on the Admin and Upload APIs. Tag lists can't express them.

## Signing and redaction

- The `list` delivery type stays restricted on the account. The service signs each list URL locally with `cloudinary.url` (`type: "list"`, `sign_url: true`, and the API secret). `cloudinary.url` consumes its options object, so pass a fresh object on every call.
- A signed URL's `s--…--` segment derives from the API secret. Keep the signed URL and the raw response body out of logs, errors, and spans: failures map to a fixed `CloudinarySearchError` with no cause.
- Each tracing layer that sees the request names spans after the full URL. Keep all three guards:
  - `listTaggedAssets` disables Effect client spans with `HttpClient.TracerDisabledWhen`.
  - `CloudinaryService.Live` sends requests through `untracedFetch`, which runs `fetch` with OpenTelemetry tracing suppressed. Apps must use `Live`. A layer built from `Default` with its own `FetchHttpClient.Fetch` loses this guard.
  - `CloudinarySignatureRedactor` (`@deskohub/cloudinary/telemetry`) rewrites signature segments to `s--REDACTED--`. Workspace lists it before the exporters of every tracer provider and of the `registerOTel` options, all built in `apps/deskohub-workspace/shared/backend/observability/telemetry-sinks.ts`. List the redactors before the exporters in any new tracer provider, including a future Boardgame Bar one.
- Use only the synthetic `s--fake-signature--` segment in tests. Regression tests: `packages/cloudinary/src/service.test.ts`, `packages/cloudinary/src/telemetry.test.ts`, and `apps/deskohub-workspace/shared/backend/observability/telemetry-sinks.test.ts`.

## Expression semantics and limits

- The outer expression array is OR, each inner group is AND, and `!tag` excludes assets with that tag. The service fetches each distinct tag once, combines lists in memory, then sorts and applies `maxResults`.
- A group without a positive tag selects nothing. There's no "all images" list, so never use an empty or exclusion-only expression to mean everything.
- A 404 means no asset has the tag and returns an empty list. 5xx responses retry under the shared transient retry policy, and each request times out after 5 seconds.
- Each list holds at most 1,000 assets and silently truncates past that. Split the tag before you rely on a larger gallery.
- Lists carry `public_id`, `version`, `format`, `width`, `height`, `type`, `created_at`, and `context.custom`. The service derives `secure_url` and `url`. `asset_id`, `folder`, `tags`, and update time are absent, so `sortBy: "updated_at"` falls back to creation time.

## Freshness

Cloudinary regenerates each list at most once a minute, so a refetch right after a webhook revalidation can read the previous list. Keep both the Workspace webhook's `cloudinaryTags.all()` revalidation and the bounded gallery cache profile in `apps/deskohub-workspace/features/gallery/backend/get-cloudinary-images.server.ts`; don't switch it to `max`. Failures cache an empty list with a short profile that expires within the 5-minute prerender threshold, so an outage never fails a prerender.
