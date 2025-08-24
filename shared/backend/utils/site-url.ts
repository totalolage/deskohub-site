/**
 * Site URL utility
 *
 * Provides a consistent way to get the site URL for generating
 * absolute URLs in emails and other server-side contexts.
 */

import { env } from "@/env";
import { isDev } from "@/shared/utils/environment";

/**
 * Get the site URL from environment variables
 * Falls back to localhost in development if not set
 */
export function getSiteUrl(): URL {
  if (typeof window !== "undefined") {
    return new URL(window.location.origin);
  }

  const vercelUrl = env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelUrl) {
    return new URL(vercelUrl);
  }

  // Fallback for development
  const dev = isDev();
  if (dev) {
    const url = new URL(`http://localhost`);
    url.port = String(process.env.PORT || 3000);
    return url;
  }

  throw new Error(
    `Site URL not found. ${JSON.stringify({
      isClient: typeof window !== "undefined",
      isDev: dev,
      vercelUrl,
    })}`
  );
}

/**
 * Build an absolute URL for a given path
 * @param path - The path to append to the site URL (should start with /)
 */
export function buildAbsoluteUrl(path: string): URL {
  const siteUrl = getSiteUrl();
  siteUrl.pathname = path;
  return siteUrl;
}
