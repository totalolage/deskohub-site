const sharedCacheBlockingDirectives = new Set([
  "no-cache",
  "no-store",
  "private",
]);

/**
 * Whether a shared cache may store and reuse `response` without revalidating
 * it: only successful responses whose `Cache-Control` allows it.
 */
export const isReusableBySharedCache = (response: Response) =>
  response.ok &&
  !(response.headers.get("Cache-Control") ?? "")
    .split(",")
    .some((directive) =>
      sharedCacheBlockingDirectives.has(
        directive.split("=")[0]?.trim().toLowerCase() ?? ""
      )
    );
