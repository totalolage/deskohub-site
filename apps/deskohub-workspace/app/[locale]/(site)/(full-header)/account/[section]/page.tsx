import type { Metadata } from "next";
import {
  AccountSectionRoute,
  getAccountSectionMetadata,
} from "@/features/account/components/account-section-route";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

type AccountSectionPageProps = {
  readonly params: Promise<{ readonly section: string }>;
};

export async function generateMetadata({
  params,
}: AccountSectionPageProps): Promise<Metadata> {
  const { section } = await params;
  return runWithRequestLocale((locale) =>
    getAccountSectionMetadata(locale, section)
  );
}

export default function CustomerAccountSectionPage({
  params,
}: AccountSectionPageProps) {
  return runWithRequestLocale((locale) => (
    <AccountSectionRoute
      locale={locale}
      section={params.then(({ section }) => section)}
    />
  ));
}
