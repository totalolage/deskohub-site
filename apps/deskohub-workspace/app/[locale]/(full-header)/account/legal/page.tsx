import { Effect, Result } from "effect";
import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { AccountLoading } from "@/features/account/components/account-loading";
import { PublicAccountLegal } from "@/features/account/components/public-account-legal";
import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getMarketingPreferences } from "@/features/legal/marketing-preferences.server";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountLegalTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default function PublicAccountLegalPage() {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountLoading locale={locale} />}>
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

  const accountsEnabled = await areAccountsEnabled();
  const session = await Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.provide(CustomerAuthentication.Default),
    Effect.result,
    runWorkspaceEffect("account.legal", { boundary: "page" })
  );
  const signedIn = Result.isSuccess(session) && session.success !== null;
  const marketingPreferences = await getMarketingPreferences(locale);

  return (
    <PublicAccountLegal
      accountsEnabled={accountsEnabled}
      locale={locale}
      marketingPreferences={marketingPreferences}
      signedIn={signedIn}
    />
  );
}
