import type { Metadata } from "next";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getPricingContent, PricingPage } from "@/features/pricing";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const content = getPricingContent(locale);

    return {
      title: content.metadataTitle,
      description: content.metadataDescription,
    };
  });
}

export default async function PricingPageRoute() {
  return runWithRequestLocale((locale) => <PricingPage locale={locale} />);
}
