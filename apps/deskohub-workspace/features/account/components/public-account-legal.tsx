import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import type { Locale } from "@/features/i18n";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

type PublicAccountLegalProps = {
  readonly analyticsPreference?: AnalyticsPreferenceState;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
};

export function PublicAccountLegal({
  analyticsPreference,
  locale,
  marketingPreferences,
}: PublicAccountLegalProps) {
  return (
    <LegalScreen
      analyticsPreference={analyticsPreference}
      locale={locale}
      marketingPreferences={marketingPreferences}
    />
  );
}
