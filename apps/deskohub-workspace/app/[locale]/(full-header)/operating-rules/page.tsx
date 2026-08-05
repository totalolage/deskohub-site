import type { Metadata } from "next";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { LegalPage } from "@/features/legal";
import { createLegalMetadata } from "@/features/legal/metadata";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) =>
    createLegalMetadata(locale, "operating-rules")
  );
}

export default async function OperatingRulesPage() {
  return runWithRequestLocale((locale) => (
    <LegalPage locale={locale} documentKey="operating-rules" />
  ));
}
