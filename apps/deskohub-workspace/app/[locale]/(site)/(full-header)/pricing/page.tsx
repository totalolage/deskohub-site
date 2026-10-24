import type { Metadata, ResolvingMetadata } from "next";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { PricingPage } from "@/features/pricing";
import { createPublicPageMetadata } from "@/features/public-pages/page-metadata";

export const instant = true;

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createPublicPageMetadata(
      {
        locale,
        pathname: "/pricing",
        title: m.pricingPageTitle({}, { locale }),
        description: m.pricingMetadataDescription({}, { locale }),
      },
      parent
    )
  );
}

export default async function LocalizedWorkspacePricingPage() {
  return runWithRequestLocale((locale) => <PricingPage locale={locale} />);
}
