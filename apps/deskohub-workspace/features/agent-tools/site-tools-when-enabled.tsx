import "server-only";

import { GlobalReleaseGate } from "@/features/feature-flags/components/global-release-gate";
import type { Locale } from "@/features/i18n";
import { areSiteToolsEnabled } from "./site-tools-feature-flag.server";
import { SiteToolsRegistrar } from "./webmcp/site-tools-registrar";

/**
 * Mounts {@link SiteToolsRegistrar} only while the site tools release gate is
 * on.
 */
export function SiteToolsWhenEnabled({ locale }: { readonly locale: Locale }) {
  return (
    <GlobalReleaseGate flag="webmcp_site_tools" isEnabled={areSiteToolsEnabled}>
      <SiteToolsRegistrar locale={locale} />
    </GlobalReleaseGate>
  );
}
