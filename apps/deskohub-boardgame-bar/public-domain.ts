import { siteConstants } from "@/shared/utils/constants";

type PublicDomainSources = {
  vercelUrl: string | undefined;
  productionUrl: string | undefined;
  nodeEnv: string | undefined;
  port: string | undefined;
};

/**
 * Resolves the site's public origin: the browser's own origin, then the
 * deployment URL, then the production URL, then the local dev server, and
 * finally the public brand domain.
 */
export const resolvePublicDomain = ({
  vercelUrl,
  productionUrl,
  nodeEnv,
  port,
}: PublicDomainSources): string => {
  if (typeof window !== "undefined") return window.location.origin;
  if (vercelUrl) return vercelUrl;
  if (productionUrl) return productionUrl;
  if (nodeEnv === "development") {
    return `http://localhost:${port || 3000}`;
  }
  return `https://${siteConstants.brand.publicDomain}`;
};
