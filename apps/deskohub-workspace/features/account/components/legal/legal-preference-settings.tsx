import { CookieSettings } from "@/features/cookie-consent/components/cookie-settings-page";
import type { Locale } from "@/features/i18n";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import { AnalyticsPreferenceRow } from "@/features/legal/components/analytics-preference-row";
import { MarketingPreferencesForm } from "@/features/legal/components/marketing-preferences-form";
import {
  isManagedMarketingState,
  type MarketingPreferencesState,
} from "@/features/legal/marketing-preferences";
import { PreferenceRowGroup } from "@/shared/components/ui/preference-row";

export interface LegalPreferenceSettingsProps {
  readonly analyticsPreference?: AnalyticsPreferenceState;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
}

/**
 * Legal-screen presentation composition of the consent and marketing
 * preference rows. A signed-in account's analytics preference follows the
 * cookie categories as a peer row card, and managed marketing states join
 * them as the last peer row card; fallback marketing states render as
 * separately spaced guidance outside the row group instead of pretending to
 * be a card.
 */
export function LegalPreferenceSettings({
  analyticsPreference,
  locale,
  marketingPreferences,
}: LegalPreferenceSettingsProps) {
  const state = marketingPreferences ?? { status: "unavailable" };
  const analyticsState = analyticsPreference ?? { status: "signed-out" };
  const marketingForm = (
    <MarketingPreferencesForm locale={locale} state={state} />
  );
  const consentRows = (
    <>
      <CookieSettings locale={locale} />
      {analyticsState.status !== "signed-out" && (
        <AnalyticsPreferenceRow locale={locale} state={analyticsState} />
      )}
    </>
  );

  return isManagedMarketingState(state) ? (
    <PreferenceRowGroup className="mt-6">
      {consentRows}
      {marketingForm}
    </PreferenceRowGroup>
  ) : (
    <>
      <PreferenceRowGroup className="mt-6">{consentRows}</PreferenceRowGroup>
      <div className="mt-8 min-w-0">{marketingForm}</div>
    </>
  );
}
