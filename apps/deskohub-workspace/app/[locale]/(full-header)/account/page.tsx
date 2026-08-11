import type { Metadata } from "next";
import { connection } from "next/server";
import { AccountPage } from "@/features/account/components/account-page";
import { loadCustomerAccountPage } from "@/features/account/page-data.server";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountMetadataTitle({}, { locale }),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function CustomerAccountPage() {
  await connection();

  return runWithRequestLocale(async (locale) => {
    const data = await loadCustomerAccountPage(locale);
    return <AccountPage locale={locale} {...data} />;
  });
}
