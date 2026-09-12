"use client";

import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import type { Locale } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

type PublicAccountLegalProps = {
  readonly accountsEnabled: boolean;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
};

export function PublicAccountLegal({
  accountsEnabled,
  locale,
  marketingPreferences,
}: PublicAccountLegalProps) {
  const copy = getAccountScreenCopy(locale);

  return (
    <LegalScreen
      accountsEnabled={accountsEnabled}
      locale={locale}
      marketingPreferences={marketingPreferences}
      strings={copy.legal}
    />
  );
}
