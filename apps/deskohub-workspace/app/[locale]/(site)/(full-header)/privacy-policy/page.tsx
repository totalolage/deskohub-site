import type { Metadata, ResolvingMetadata } from "next";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

export async function generateMetadata(
  _props: PageProps<"/[locale]/privacy-policy">,
  parent: ResolvingMetadata
): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createLegalMetadata(locale, "privacy-policy", parent)
  );
}

export default async function PrivacyPolicyPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="privacy-policy" />
  ));
}
