import type { Metadata } from "next";
import { getWorkspaceAlternates, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { PricingPage } from "@/features/pricing";
import { workspaceSiteConstants } from "@/shared/utils";

export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.pricingPageTitle({}, { locale });
    const description = m.pricingMetadataDescription({}, { locale });
    const alternates = getWorkspaceAlternates(locale, "/pricing");

    return {
      title,
      description,
      alternates,
      openGraph: {
        title,
        description,
        url: alternates.canonical,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedWorkspacePricingPage() {
  return runWithRequestLocale((locale) => <PricingPage locale={locale} />);
}
