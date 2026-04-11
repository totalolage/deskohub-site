import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isWorkspaceLocale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

type CookiePolicyPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: CookiePolicyPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isWorkspaceLocale(locale)) notFound();

  return runWithRequestLocale(locale, () =>
    createLegalMetadata(locale, "cookie-policy")
  );
}

export default async function CookiePolicyPage({
  params,
}: CookiePolicyPageProps) {
  const { locale } = await params;
  if (!isWorkspaceLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <LegalPage locale={locale} documentKey="cookie-policy" />
  ));
}
