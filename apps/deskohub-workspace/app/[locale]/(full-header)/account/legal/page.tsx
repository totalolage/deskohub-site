import type { Metadata } from "next";
import { PublicAccountLegal } from "@/features/account/components/public-account-legal";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountLegalTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default function PublicAccountLegalPage() {
  return runWithRequestLocale((locale) => (
    <PublicAccountLegal locale={locale} signedIn={false} />
  ));
}
