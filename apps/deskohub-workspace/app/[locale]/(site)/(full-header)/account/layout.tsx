import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import { AccountLoading } from "@/features/account/components/account-loading";
import { arePasskeysEnabled } from "@/features/account/server/account-feature-flag.server";
import { isCustomerSignedIn } from "@/features/account/server/customer-session.server";
import type { Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { areReferralsEnabled } from "@/features/referrals/referral-feature-flag.server";
import { PageNavigationBoundary } from "@/shared/components/page-navigation-boundary";

type AccountLayoutProps = {
  readonly children: ReactNode;
  readonly modal: ReactNode;
};

export default function AccountLayout({ children, modal }: AccountLayoutProps) {
  return runWithRequestLocale((locale) => (
    <Suspense fallback={<AccountLoading locale={locale} />}>
      <AccountLayoutContent locale={locale} modal={modal}>
        {children}
      </AccountLayoutContent>
    </Suspense>
  ));
}

async function AccountLayoutContent({
  children,
  locale,
  modal,
}: AccountLayoutProps & { readonly locale: Locale }) {
  await connection();

  const [passkeysEnabled, referralsEnabled, signedIn] = await Promise.all([
    arePasskeysEnabled(),
    areReferralsEnabled(),
    isCustomerSignedIn(),
  ]);

  return (
    <AccountLayoutShell
      locale={locale}
      passkeysEnabled={passkeysEnabled}
      referralsEnabled={referralsEnabled}
      signedIn={signedIn}
    >
      <PageNavigationBoundary>
        {children}
        {modal}
      </PageNavigationBoundary>
    </AccountLayoutShell>
  );
}
