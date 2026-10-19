import type { Metadata } from "next";
import { AuthPageShell } from "@/features/account/components/auth-card";
import { SignInRouteCard } from "@/features/account/components/sign-in-route";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { SearchParamsRecord } from "@/shared/utils/search-params";

export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => ({
    title: m.accountSignInMetadataTitle({}, { locale }),
    description: m.accountSignInMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default function CustomerSignInPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  return runWithRequestLocale((locale) => (
    <AuthPageShell>
      <SignInRouteCard locale={locale} searchParams={searchParams} />
    </AuthPageShell>
  ));
}
