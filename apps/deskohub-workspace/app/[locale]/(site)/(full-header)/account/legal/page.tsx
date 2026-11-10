import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { getAccountDataExportAvailability } from "@/features/account/account-data-export-availability.server";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { PublicAccountLegal } from "@/features/account/components/public-account-legal";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getAnalyticsPreference } from "@/features/legal/analytics-preference.server";
import { getMarketingPreferences } from "@/features/legal/marketing-preferences.server";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountLegalTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default function PublicAccountLegalPage() {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <PublicAccountLegalPageContent locale={locale} />
    </Suspense>
  ));
}

async function PublicAccountLegalPageContent({
  locale,
}: {
  readonly locale: Locale;
}) {
  await connection();

  const [
    marketingPreferences,
    analyticsPreference,
    accountDataExportAvailable,
  ] = await Promise.all([
    getMarketingPreferences(locale),
    getAnalyticsPreference(locale),
    getAccountDataExportAvailability(locale),
  ]);

  return (
    <PublicAccountLegal
      accountDataExportAvailable={accountDataExportAvailable}
      analyticsPreference={analyticsPreference}
      locale={locale}
      marketingPreferences={marketingPreferences}
    />
  );
}
