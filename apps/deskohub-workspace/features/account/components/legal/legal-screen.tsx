import { CookieSettings } from "@/features/cookie-consent/components/cookie-settings-page";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { Card } from "@/shared/components/ui/card";

export interface LegalScreenStrings {
  readonly title: string;
  readonly analyticsTitle: string;
  readonly analyticsDescription: string;
  readonly marketingTitle: string;
  readonly marketingDescription: string;
  readonly preferencesUnavailable: string;
  readonly unavailable: string;
  readonly archiveTitle: string;
  readonly archiveDescription: string;
  readonly archiveAction: string;
  readonly savePreferences: string;
}

export interface LegalScreenProps {
  readonly locale: Locale;
  readonly strings: LegalScreenStrings;
}

export function LegalScreen({ locale, strings }: LegalScreenProps) {
  const localePath = `/${locale}`;

  return (
    <Card className="min-w-0 rounded-3xl border-[#dfe4ec] bg-white p-5 sm:p-8">
      <h2 className="min-w-0 break-words text-[26px] font-bold leading-[1.15] tracking-[-0.025em] text-[#00024f]">
        {strings.title}
      </h2>

      <div className="mt-5 border-t border-[#e5e9ef] pt-4">
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
      </div>

      <CookieSettings locale={locale} />
    </Card>
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
