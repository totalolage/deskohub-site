import Link from "next/link";
import { m, type WorkspaceLocale } from "@/features/i18n";
import { getPricingPath } from "@/features/pricing";
import { Container } from "@/shared/components/container";
import { workspaceSiteConstants } from "@/shared/utils";

type PublicSiteFooterProps = {
  locale: WorkspaceLocale;
};

export function PublicSiteFooter({ locale }: PublicSiteFooterProps) {
  const localePath = `/${locale}`;
  const companyExtractPath = "/official-company-extract";
  const companyAddress = `${workspaceSiteConstants.contact.address.street}, ${workspaceSiteConstants.contact.address.postalCode} ${workspaceSiteConstants.contact.address.city} - ${workspaceSiteConstants.contact.address.cityDistrict}`;
  const addressLabel =
    locale === "cs-CZ" ? "Adresa provozovny" : "Establishment address";
  const commercialRegisterDisclosure =
    locale === "cs-CZ"
      ? "Údaje o zápisu v obchodním rejstříku jsou k dispozici v odkazovaném oficiálním výpisu společnosti."
      : "Commercial register details are available in the linked official company extract.";

  return (
    <footer className="border-t border-white/12 bg-navy-blue text-white">
      <Container className="py-10 sm:py-14">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr_1fr]">
          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sunset-yellow">
              {m.footerCompanyLabel({}, { locale })}
            </p>
            <div className="space-y-2 text-sm leading-7 text-white/78 sm:text-base">
              <p className="text-xl text-white">
                {workspaceSiteConstants.brand.legalName}
              </p>
              <p>
                {m.footerCompanyIdLabel({}, { locale })}:{" "}
                {workspaceSiteConstants.company.identificationNumber}
              </p>
              <p>
                {addressLabel}: {companyAddress}
              </p>
              <p>{m.footerVatStatus({}, { locale })}</p>
              <p>{commercialRegisterDisclosure}</p>
              <p>
                <a
                  href={`mailto:${workspaceSiteConstants.contact.infoEmail}`}
                  className="transition-colors hover:text-sunset-yellow"
                >
                  {workspaceSiteConstants.contact.infoEmail}
                </a>
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sunset-yellow">
              {m.footerLegalLabel({}, { locale })}
            </p>
            <nav
              aria-label={m.footerLegalLabel({}, { locale })}
              className="grid gap-3 text-sm leading-6 text-white/78"
            >
              <Link
                href={`${localePath}/privacy-policy`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerPrivacyLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/terms-and-conditions`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerTermsLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/operating-rules`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerOperatingRulesLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/cookie-policy`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerCookiePolicyLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/cookie-settings`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerCookieSettingsLink({}, { locale })}
              </Link>
              <Link
                href={getPricingPath(locale)}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerPricingLink({}, { locale })}
              </Link>
              <a
                href={companyExtractPath}
                download="deskohub-company-extract.pdf"
                target="_blank"
                rel="noreferrer"
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerCompanyExtractLink({}, { locale })}
              </a>
            </nav>
          </div>

          <div className="space-y-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sunset-yellow">
              {m.footerWorkspaceLabel({}, { locale })}
            </p>
            <nav
              aria-label={m.footerWorkspaceLabel({}, { locale })}
              className="grid gap-3 text-sm leading-6 text-white/78"
            >
              <Link
                href={`${localePath}`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerHomeLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/contact`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerContactLink({}, { locale })}
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-5 text-sm text-white/56">
          {m.footerCopyright(
            {
              year: new Date().getFullYear(),
              companyName: workspaceSiteConstants.brand.legalName,
            },
            { locale }
          )}
        </div>
      </Container>
    </footer>
  );
}
