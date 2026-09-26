import { CookieSettings } from "@/features/cookie-consent/components/cookie-settings-page";
import type { Locale } from "@/features/i18n";
import { MarketingPreferencesForm } from "@/features/legal/components/marketing-preferences-form";
import {
  isManagedMarketingState,
  type MarketingPreferencesState,
} from "@/features/legal/marketing-preferences";
import { PreferenceRowGroup } from "@/shared/components/ui/preference-row";

export interface LegalPreferenceSettingsProps {
  readonly accountsEnabled?: boolean;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
}

/**
 * Legal-screen presentation composition of the consent and marketing
 * preference rows. Managed marketing states join the cookie categories as a
 * fifth peer row card; fallback states render as separately spaced guidance
 * outside the row group instead of pretending to be a card.
 */
export function LegalPreferenceSettings({
  accountsEnabled = true,
  locale,
  marketingPreferences,
}: LegalPreferenceSettingsProps) {
  const state = marketingPreferences ?? { status: "unavailable" };
  const marketingForm = (
    <MarketingPreferencesForm
      accountsEnabled={accountsEnabled}
      locale={locale}
      state={state}
    />
  );

  return isManagedMarketingState(state) ? (
    <PreferenceRowGroup className="mt-6">
      <CookieSettings locale={locale} />
      {marketingForm}
    </PreferenceRowGroup>
  ) : (
    <>
      <PreferenceRowGroup className="mt-6">
        <CookieSettings locale={locale} />
      </PreferenceRowGroup>
      <div className="mt-8 min-w-0">{marketingForm}</div>
    </>
  );
}
