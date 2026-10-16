import type { Metadata } from "next";
import { AccountSectionRoute } from "@/features/account/components/account-section-route";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountMetadataTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function CustomerAccountPageRoute() {
  return runWithRequestLocale((locale) => (
    <AccountSectionRoute locale={locale} />
  ));
}
