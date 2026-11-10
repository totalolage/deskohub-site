import { AccountDataExport } from "@/features/account/components/legal/account-data-export";
import { LegalPreferenceSettings } from "@/features/account/components/legal/legal-preference-settings";
import { AccountSectionPanel } from "@/features/account/components/shell/account-section-panel";
import { getAccountDataExportPath } from "@/features/account/routes";
import { type Locale, m } from "@/features/i18n";
import type { AnalyticsPreferenceState } from "@/features/legal/analytics-preference";
import type { MarketingPreferencesState } from "@/features/legal/marketing-preferences";
import { GuardedLink } from "@/shared/components/guarded-link";

export interface LegalScreenProps {
  /** Whether the export route would serve this session its data archive. */
  readonly accountDataExportAvailable?: boolean;
  readonly analyticsPreference?: AnalyticsPreferenceState;
  readonly locale: Locale;
  readonly marketingPreferences?: MarketingPreferencesState;
}

const legalScreenTitleId = "account-legal-title";
const accountDataExportTitleId = "account-data-export-title";

export function LegalScreen({
  accountDataExportAvailable = false,
  analyticsPreference,
  locale,
  marketingPreferences,
}: LegalScreenProps) {
  const localePath = `/${locale}`;

  return (
    <AccountSectionPanel
      className="min-w-0"
      title={m.legalScreenTitle({}, { locale })}
      titleId={legalScreenTitleId}
    >
      {/* Named by the section title: the footer already owns the "Legal" navigation landmark. */}
      <nav
        aria-labelledby={legalScreenTitleId}
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

      <LegalPreferenceSettings
        analyticsPreference={analyticsPreference}
        locale={locale}
        marketingPreferences={marketingPreferences}
      />

      {/* Offered only to a session the export route would serve, so the
          download never answers a refusal. The route still authorizes every
          request itself. */}
      {accountDataExportAvailable && (
        <section
          aria-labelledby={accountDataExportTitleId}
          className="mt-8 min-w-0 border-t border-[#e5e9ef] pt-6"
        >
          <h3
            className="break-words text-[18px] font-semibold leading-6 text-[#1f2d43]"
            id={accountDataExportTitleId}
          >
            {m.legalScreenExportTitle({}, { locale })}
          </h3>
          <p className="mt-1 break-words text-base leading-6 text-[#586c88]">
            {m.legalScreenExportDescription({}, { locale })}
          </p>
          <AccountDataExport
            href={getAccountDataExportPath(locale)}
            locale={locale}
          />
          <p className="mt-4 break-words text-sm leading-5 text-[#586c88]">
            {m.legalScreenExportOmissions({}, { locale })}
          </p>
          <p className="mt-2 text-sm leading-5">
            <PolicyLink
              href={`${localePath}/privacy-policy`}
              label={m.legalScreenExportFullRequestLink({}, { locale })}
            />
          </p>
        </section>
      )}
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
