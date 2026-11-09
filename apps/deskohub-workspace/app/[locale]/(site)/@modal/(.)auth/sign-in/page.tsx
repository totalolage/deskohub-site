import { Suspense } from "react";
import { AuthModal } from "@/features/account/components/auth-modal";
import { SignInCardSkeleton } from "@/features/account/components/sign-in-loading";
import { SignInRouteCard } from "@/features/account/components/sign-in-route";
import { m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import type { SearchParamsRecord } from "@/shared/utils/search-params";

export const instant = false;

export default function CustomerSignInModalPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  return runWithRequestLocale((locale) => (
    <AuthModal
      locale={locale}
      title={m.accountSignInTitle({}, { locale })}
      description={m.accountSignInMetadataDescription({}, { locale })}
    >
      <Suspense fallback={<SignInCardSkeleton locale={locale} />}>
        <SignInRouteCard locale={locale} searchParams={searchParams} />
      </Suspense>
    </AuthModal>
  ));
}
