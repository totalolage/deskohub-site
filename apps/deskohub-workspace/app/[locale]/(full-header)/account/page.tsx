import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AccountContentLoading } from "@/features/account/components/account-loading";
import { AccountPage } from "@/features/account/components/account-page";
import { parseSavedCardFlowFeedback } from "@/features/account/contracts";
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

export default async function CustomerAccountPageRoute({
  searchParams,
}: {
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountContentLoading locale={locale} />}>
      <CustomerAccountPageContent locale={locale} searchParams={searchParams} />
    </Suspense>
  ));
}

async function CustomerAccountPageContent({
  locale,
  searchParams,
}: {
  readonly locale: Locale;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  await connection();
  if (!(await areAccountsEnabled())) notFound();

  const [state, params] = await Promise.all([
    loadCustomerAccountPage(locale),
    searchParams ?? Promise.resolve(undefined),
  ]);
  const cardFlowParam = params?.cardFlow;
  const cardFlow = parseSavedCardFlowFeedback(
    Array.isArray(cardFlowParam) ? cardFlowParam[0] : cardFlowParam
  );

  return <AccountPage cardFlow={cardFlow} locale={locale} state={state} />;
}
