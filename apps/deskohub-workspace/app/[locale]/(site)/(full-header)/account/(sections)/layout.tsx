import type { ReactNode } from "react";
import { AccountSections } from "@/features/account/components/account-section-route";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";

export default function AccountSectionsLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return runWithRequestLocale((locale) => (
    <>
      <AccountSections locale={locale} />
      {children}
    </>
  ));
}
