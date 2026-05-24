import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

type TermsAndConditionsPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: TermsAndConditionsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () =>
    createLegalMetadata(locale, "terms-and-conditions")
  );
}

export default async function TermsAndConditionsPage({
  params,
}: TermsAndConditionsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <LegalPage locale={locale} documentKey="terms-and-conditions" />
  ));
}
