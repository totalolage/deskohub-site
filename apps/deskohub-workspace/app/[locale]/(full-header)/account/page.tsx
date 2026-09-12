import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { AccountPage } from "@/features/account/components/account-page";
import { loadCustomerAccountPage } from "@/features/account/page-data.server";
import { areAccountsEnabled } from "@/features/account/server/account-feature-flag.server";
import { type Locale, m } from "@/features/i18n";
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
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <CustomerAccountPageContent locale={locale} />
    </Suspense>
  ));
}

async function CustomerAccountPageContent({
  locale,
}: {
  readonly locale: Locale;
}) {
  await connection();
  if (!(await areAccountsEnabled())) notFound();

  const state = await loadCustomerAccountPage(locale);

  return <AccountPage locale={locale} state={state} />;
}
