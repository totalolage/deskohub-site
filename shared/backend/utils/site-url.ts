/**
 * Site URL utility
 *
 * Provides a consistent way to get the site URL for generating
 * absolute URLs in emails and other server-side contexts.
 */

import { isDev } from "@/shared/utils/environment";

type SiteUrlConfig = {
  currentOrigin?: string;
  vercelProjectProductionUrl?: string;
  nextPublicVercelUrl?: string;
  nodeEnv?: string;
  vercelEnv?: string;
  port?: string | number;
};

const normalizeOptionalUrl = (
  input: string | undefined
): string | undefined => {
  if (!input) return undefined;
  if (input.startsWith("http://") || input.startsWith("https://")) {
    return input;
  }
  return `https://${input}`;
};

/**
 * Get the site URL from environment variables
 * Falls back to localhost in development if not set
 */
export function getSiteUrl(config: SiteUrlConfig = {}): URL {
  const currentOrigin =
    config.currentOrigin ??
    (typeof window !== "undefined" ? window.location.origin : undefined);

  if (currentOrigin) {
    return new URL(currentOrigin);
  }

  const vercelPreviewUrl = normalizeOptionalUrl(
    config.nextPublicVercelUrl ?? process.env.NEXT_PUBLIC_VERCEL_URL
  );
  if (vercelPreviewUrl) {
    return new URL(vercelPreviewUrl);
  }

  const vercelProductionUrl = normalizeOptionalUrl(
    config.vercelProjectProductionUrl ??
      process.env.VERCEL_PROJECT_PRODUCTION_URL
  );
  if (vercelProductionUrl) {
    return new URL(vercelProductionUrl);
  }

  // Fallback for development
  const dev = isDev({
    nodeEnv: config.nodeEnv,
    vercelEnv: config.vercelEnv,
  });
  if (dev) {
    const url = new URL(`http://localhost`);
    const port = config.port ?? process.env.PORT ?? 3000;
    url.port = String(port);
    return url;
  }

  throw new Error(
    `Site URL not found. ${JSON.stringify({
      isClient: typeof window !== "undefined",
      isDev: dev,
      vercelPreviewUrl,
      vercelProductionUrl,
    })}`
  );
}

/**
 * Build an absolute URL for a given path
 * @param path - The path to append to the site URL (should start with /)
 */
export function buildAbsoluteUrl(path: string, config?: SiteUrlConfig): URL {
  const siteUrl = getSiteUrl(config);
  siteUrl.pathname = path;
  return siteUrl;
}
