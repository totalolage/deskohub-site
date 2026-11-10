import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import type { Locale } from "@/features/i18n";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

type PublicAccountLegalProps = {
  readonly accountDataExportAvailable?: boolean;
  readonly analyticsPreference?: AnalyticsPreferenceState;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
};

export function PublicAccountLegal({
  accountDataExportAvailable,
  analyticsPreference,
  locale,
  marketingPreferences,
}: PublicAccountLegalProps) {
  return (
    <LegalScreen
      accountDataExportAvailable={accountDataExportAvailable}
      analyticsPreference={analyticsPreference}
      locale={locale}
      marketingPreferences={marketingPreferences}
    />
  );
}
