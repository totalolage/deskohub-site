import type { MetadataRoute } from "next";
import { env } from "@/env";
import { getWorkspaceCanonicalUrl } from "@/shared/utils";

/**
 * Production admits every crawler, including AI training crawlers. Pages that
 * must stay out of search results say so with `noindex`, which a crawler only
 * sees when robots.txt lets it fetch the page. Other deployments block all.
 */
export default function robots(): MetadataRoute.Robots {
  if (env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: getWorkspaceCanonicalUrl("/sitemap.xml"),
  };
}
