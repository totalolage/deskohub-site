import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getPricingContent, PricingPage } from "@/features/pricing";

type PricingPageRouteProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PricingPageRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  const content = getPricingContent(locale);

  return {
    title: content.metadataTitle,
    description: content.metadataDescription,
  };
}

export default async function PricingPageRoute({
  params,
}: PricingPageRouteProps) {
  const { locale } = await params;
  if (!isLocale(locale)) {
    notFound();
  }

  return runWithRequestLocale(locale, () => <PricingPage locale={locale} />);
}
