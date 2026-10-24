import type { Metadata, ResolvingMetadata } from "next";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

export async function generateMetadata(
  _props: unknown,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createLegalMetadata(locale, "terms-and-conditions", parent)
  );
}

export default async function TermsAndConditionsPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="terms-and-conditions" />
  ));
}
