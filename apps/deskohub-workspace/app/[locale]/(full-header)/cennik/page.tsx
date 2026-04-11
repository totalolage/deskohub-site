import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isWorkspaceLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { PricingPage, getPricingContent } from "@/features/pricing";

type PricingPageRouteProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: PricingPageRouteProps): Promise<Metadata> {
  const { locale } = await params;
  if (locale !== "cs-CZ" || !isWorkspaceLocale(locale)) notFound();

  const content = getPricingContent(locale);

  return {
    title: content.metadataTitle,
    description: content.metadataDescription,
  };
}

export default async function CzechPricingPage({
  params,
}: PricingPageRouteProps) {
  const { locale } = await params;
  if (locale !== "cs-CZ" || !isWorkspaceLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => <PricingPage locale={locale} />);
}
