import "server-only";

import { connection } from "next/server";
import { Suspense } from "react";
import type { Locale } from "@/features/i18n";
import { areSiteToolsEnabled } from "./site-tools-feature-flag.server";
import { SiteToolsRegistrar } from "./webmcp/site-tools-registrar";

/**
 * Mounts {@link SiteToolsRegistrar} only while the site tools release gate is
 * on. The flag may depend on the request, so it is evaluated after the static
 * shell, which stays the same for every visitor.
 */
export function SiteToolsWhenEnabled({ locale }: { readonly locale: Locale }) {
  return (
    <Suspense fallback={null}>
      <SiteToolsIfEnabled locale={locale} />
    </Suspense>
  );
}

async function SiteToolsIfEnabled({ locale }: { readonly locale: Locale }) {
  await connection();
  return (
    (await areSiteToolsEnabled()) && <SiteToolsRegistrar locale={locale} />
  );
}
