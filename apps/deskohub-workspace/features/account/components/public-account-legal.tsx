"use client";

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
  return (
    <LegalScreen
      accountsEnabled={accountsEnabled}
      locale={locale}
      marketingPreferences={marketingPreferences}
    />
  );
}
