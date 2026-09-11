import { Effect, Result } from "effect";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { AccountLayoutShell } from "@/features/account/components/account-layout-shell";
import { AccountLoading } from "@/features/account/components/account-loading";
import type { Locale } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
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

  const session = await Effect.flatMap(
    CustomerAuthentication,
    (authentication) => authentication.currentUser
  ).pipe(
    Effect.provide(CustomerAuthentication.Default),
    Effect.result,
    runWorkspaceEffect("account.layout", { boundary: "page" })
  );
  const signedIn = Result.isSuccess(session) && session.success !== null;

  return (
    <AccountLayoutShell locale={locale} signedIn={signedIn}>
      <PageNavigationBoundary>
        {children}
        {modal}
      </PageNavigationBoundary>
    </AccountLayoutShell>
  );
}
