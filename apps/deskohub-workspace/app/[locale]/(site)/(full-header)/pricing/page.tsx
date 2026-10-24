import type { Metadata } from "next";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { PricingPage } from "@/features/pricing";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

export const instant = true;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata({
      locale,
      pathname: "/pricing",
      title: { page: m.pricingPageTitle({}, { locale }) },
      description: m.pricingMetadataDescription({}, { locale }),
    })
  );
}

export default async function LocalizedWorkspacePricingPage() {
  return runWithRequestLocale((locale) => <PricingPage locale={locale} />);
}
