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
import { parseReferralCode } from "@/features/referrals/client";
import type { SearchParamsRecord } from "@/shared/utils";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountMetadataTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function CustomerAccountPageRoute({
  searchParams,
}: {
  readonly searchParams?: Promise<SearchParamsRecord>;
} = {}) {
  const referralCode = parseReferralCode(
    searchParams ? (await searchParams).ref : undefined
  );

  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <CustomerAccountPageContent locale={locale} referralCode={referralCode} />
    </Suspense>
  ));
}

async function CustomerAccountPageContent({
  locale,
  referralCode,
}: {
  readonly locale: Locale;
  readonly referralCode: ReturnType<typeof parseReferralCode>;
}) {
  await connection();
  if (!(await areAccountsEnabled())) notFound();

  const state = await loadCustomerAccountPage(locale);

  return (
    <AccountPage locale={locale} referralCode={referralCode} state={state} />
  );
}
