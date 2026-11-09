import { LegalScreen } from "@/features/account/components/legal/legal-screen";
import type { Locale } from "@/features/i18n";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";

type PublicAccountLegalProps = {
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
};

export function PublicAccountLegal({
  locale,
  marketingPreferences,
}: PublicAccountLegalProps) {
  return (
    <LegalScreen locale={locale} marketingPreferences={marketingPreferences} />
  );
}
