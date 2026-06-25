import Link from "next/link";
import { type Locale, m } from "@/features/i18n";
import { Container } from "@/shared/components/container";
import { workspaceSiteConstants } from "@/shared/utils";

type PublicSiteFooterProps = {
  locale: Locale;
};

export async function PublicSiteFooter({ locale }: PublicSiteFooterProps) {
  const localePath = `/${locale}`;
  const reservationPath = `${localePath}/checkout/order`;
  const companyExtractPath = "/official-company-extract";
  const companyAddress = `${workspaceSiteConstants.contact.address.street}, ${workspaceSiteConstants.contact.address.postalCode} ${workspaceSiteConstants.contact.address.city} - ${workspaceSiteConstants.contact.address.cityDistrict}`;
  const copyrightYear = await getFooterCopyrightYear();

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
                {m.footerCompanyAddressLabel({}, { locale })}: {companyAddress}
              </p>
              <p>{m.footerVatStatus({}, { locale })}</p>
              <p>{m.footerCommercialRegisterDisclosure({}, { locale })}</p>
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
                prefetch={false}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerPrivacyLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/terms-and-conditions`}
                prefetch={false}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerTermsLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/operating-rules`}
                prefetch={false}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerOperatingRulesLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/cookie-policy`}
                prefetch={false}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerCookiePolicyLink({}, { locale })}
              </Link>
              <Link
                href={`${localePath}/cookie-settings`}
                prefetch={false}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerCookieSettingsLink({}, { locale })}
              </Link>
              <Link
                href={reservationPath}
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
              <Link
                href={`${localePath}/checkout/order`}
                className="transition-colors hover:text-sunset-yellow"
              >
                {m.footerReservationLink({}, { locale })}
              </Link>
            </nav>
          </div>
        </div>

        <div className="mt-10 border-t border-white/10 pt-5 text-sm text-white/56">
          {m.footerCopyright(
            {
              year: copyrightYear,
              companyName: workspaceSiteConstants.brand.legalName,
            },
            { locale }
          )}
        </div>
      </Container>
    </footer>
  );
}

async function getFooterCopyrightYear() {
  "use cache";
  return new Date().getFullYear();
}
