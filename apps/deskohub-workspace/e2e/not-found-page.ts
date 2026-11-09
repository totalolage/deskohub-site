/**
 * Whether a successful HTML response rendered a 404 not-found page instead of
 * its route. A `notFound()` thrown inside a Suspense boundary after the shell
 * has flushed keeps the 200 status and streams the boundary's 404 digest; a
 * route without its own not-found page renders Next's default 404 heading.
 * Check a page's own content first, because every App Router payload carries
 * the not-found elements its boundaries could render.
 */
export function isNotFoundPage(body: string) {
  return (
    body.includes("NEXT_HTTP_ERROR_FALLBACK;404") ||
    /<h1[^>]*class="next-error-h1"[^>]*>\s*404\s*<\/h1>/.test(body)
  );
}
