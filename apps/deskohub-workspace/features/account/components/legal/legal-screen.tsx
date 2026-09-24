import { Download } from "lucide-react";
import { FutureFeatureTooltip } from "@/features/account/components/future-feature-tooltip";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { CookieSettings } from "@/features/cookie-consent/components/cookie-settings-page";
import { type Locale, m } from "@/features/i18n";
import { MarketingPreferencesForm } from "@/features/legal/components/marketing-preferences-form";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Button } from "@/shared/components/ui/button";

export interface LegalScreenProps {
  readonly accountsEnabled?: boolean;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
}

export function LegalScreen({
  accountsEnabled = true,
  locale,
  marketingPreferences,
}: LegalScreenProps) {
  const localePath = `/${locale}`;

  return (
    <AccountSectionPanel
      className="min-w-0"
      title={m.legalScreenTitle({}, { locale })}
    >
      <nav
        aria-label={m.footerLegalLabel({}, { locale })}
        className="flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-sm leading-5"
      >
        <PolicyLink
          href={`${localePath}/privacy-policy`}
          label={m.footerPrivacyLink({}, { locale })}
        />
        <PolicyLink
          href={`${localePath}/marketing-communications`}
          label={m.footerMarketingCommunicationsLink({}, { locale })}
        />
        <PolicyLink
          href={`${localePath}/terms-and-conditions`}
          label={m.footerTermsLink({}, { locale })}
        />
        <PolicyLink
          href={`${localePath}/cookie-policy`}
          label={m.footerCookiePolicyLink({}, { locale })}
        />
      </nav>

      <CookieSettings locale={locale}>
        <MarketingPreferencesForm
          accountsEnabled={accountsEnabled}
          locale={locale}
          state={marketingPreferences ?? { status: "unavailable" }}
        />
      </CookieSettings>

      <div className="mt-8 border-t border-[#e5e9ef] pt-6">
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <h3 className="break-words text-[18px] font-semibold leading-6 text-[#1f2d43]">
              {m.legalScreenArchiveTitle({}, { locale })}
            </h3>
            <p className="mt-1 break-words text-base leading-6 text-[#586c88]">
              {m.legalScreenArchiveDescription({}, { locale })}
            </p>
          </div>
          <FutureFeatureTooltip locale={locale}>
            <Button
              className="h-auto min-w-0 max-w-full whitespace-normal px-4 py-2 text-left leading-5 lg:text-center"
              disabled
              type="button"
              variant="secondary"
            >
              <Download aria-hidden="true" className="size-4 shrink-0" />
              {m.legalScreenArchiveAction({}, { locale })}
            </Button>
          </FutureFeatureTooltip>
        </div>
      </div>
    </AccountSectionPanel>
  );
}

function PolicyLink({
  href,
  label,
}: {
  readonly href: string;
  readonly label: string;
}) {
  return (
    <GuardedLink
      className="break-words text-burned-orange underline decoration-burned-orange/40 underline-offset-4 hover:text-burned-orange-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
      href={href}
      prefetch={false}
    >
      {label}
    </GuardedLink>
  );
}
