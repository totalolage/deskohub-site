import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

type OperatingRulesPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: OperatingRulesPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () =>
    createLegalMetadata(locale, "operating-rules")
  );
}

export default async function OperatingRulesPage({
  params,
}: OperatingRulesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <LegalPage locale={locale} documentKey="operating-rules" />
  ));
}
