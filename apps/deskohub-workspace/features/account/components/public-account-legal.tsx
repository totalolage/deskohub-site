"use client";

import { useRouter } from "next/navigation";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import {
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { type Locale, m } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

type PublicAccountLegalProps = {
  readonly accountsEnabled: boolean;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
  readonly signedIn: boolean;
};

export function PublicAccountLegal({
  accountsEnabled,
  locale,
  marketingPreferences,
  signedIn,
}: PublicAccountLegalProps) {
  const router = useRouter();
  const copy = getAccountScreenCopy(locale);

  const changeSection = (section: AccountSection) => {
    if (!accountsEnabled || !signedIn || section === "legal") return;
    router.push(`/${locale}/account?section=${section}`);
  };

  return (
    <AccountShell
      activeSection="legal"
      disabledSections={
        accountsEnabled && signedIn
          ? []
          : ["reservations", "profile", "billing", "danger"]
      }
      labels={copy.shell}
      onSectionChange={changeSection}
      signOut={signedIn ? <SignOutButton locale={locale} /> : null}
      title={m.accountTitle({}, { locale })}
    >
      <LegalScreen
        accountsEnabled={accountsEnabled}
        locale={locale}
        marketingPreferences={marketingPreferences}
        strings={copy.legal}
      />
    </AccountShell>
  );
}
