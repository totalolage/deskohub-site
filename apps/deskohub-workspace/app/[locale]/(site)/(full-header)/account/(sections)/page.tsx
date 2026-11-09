import type { Metadata } from "next";
import { getAccountPageTitle } from "@/features/account/page-title";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: getAccountPageTitle(locale),
    description: m.accountMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

/** The sections' layout renders the account page; see `AccountSections`. */
export default function CustomerAccountPageRoute() {
  return null;
}
