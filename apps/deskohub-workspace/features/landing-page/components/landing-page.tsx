import type { WorkspaceLocale } from "@/features/i18n";
import { m } from "@/features/i18n";
import { workspaceSiteConstants } from "@/shared/utils";
import { LandingPageExperiencesSection } from "./landing-page-experiences-section";
import { LandingPageHeader } from "./landing-page-header";
import { LandingPageHeroSection } from "./landing-page-hero-section";
import { LandingPagePricingContactSection } from "./landing-page-pricing-contact-section";
import { LandingPageUniverseSection } from "./landing-page-universe-section";
import { LandingPageWorkspaceSection } from "./landing-page-workspace-section";

type LandingPageProps = {
  locale: WorkspaceLocale;
};

const landingPageSectionIds = {
  overview: "overview",
  ttrpg: "ttrpg",
  events: "events",
  cowork: "cowork",
  pricing: "pricing",
  privateOffice: "private-office",
  faqContact: "faq-contact",
} as const;

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const contactAddress = workspaceSiteConstants.contact.address;
  const contactEmail = workspaceSiteConstants.contact.infoEmail;
  const contactPhone = workspaceSiteConstants.contact.phone;

  const languageLabels: Record<WorkspaceLocale, string> = {
    "cs-CZ": m.languageCzech({}, { locale }),
    "en-US": m.languageEnglish({}, { locale }),
  };

  const headerLinks = [
    {
      label: m.landingNavOverview({}, { locale }),
      href: `#${landingPageSectionIds.overview}`,
    },
    {
      label: m.landingNavTtrpg({}, { locale }),
      href: `#${landingPageSectionIds.ttrpg}`,
    },
    {
      label: m.landingNavEvents({}, { locale }),
      href: `#${landingPageSectionIds.events}`,
    },
    {
      label: m.landingNavCowork({}, { locale }),
      href: `#${landingPageSectionIds.cowork}`,
    },
    {
      label: m.landingNavPricing({}, { locale }),
      href: `#${landingPageSectionIds.pricing}`,
    },
    {
      label: m.landingNavPrivateOffice({}, { locale }),
      href: `#${landingPageSectionIds.privateOffice}`,
    },
    {
      label: m.landingNavFaqContact({}, { locale }),
      href: `#${landingPageSectionIds.faqContact}`,
    },
  ];

  return (
    <>
      <LandingPageHeader
        currentLocale={locale}
        languageLabels={languageLabels}
        links={headerLinks}
        contactLabel={m.landingNavContactLabel({}, { locale })}
      />

      <main className="overflow-x-clip bg-navy-blue">
        <LandingPageHeroSection
          locale={locale}
          overviewSectionId={landingPageSectionIds.overview}
          pricingHref={localizedHash(`#${landingPageSectionIds.pricing}`)}
          eventsHref={localizedHash(`#${landingPageSectionIds.events}`)}
        />

        <LandingPageUniverseSection locale={locale} />

        <LandingPageExperiencesSection
          locale={locale}
          ttrpgSectionId={landingPageSectionIds.ttrpg}
          eventsSectionId={landingPageSectionIds.events}
          faqContactHref={localizedHash(`#${landingPageSectionIds.faqContact}`)}
        />

        <LandingPageWorkspaceSection
          locale={locale}
          coworkSectionId={landingPageSectionIds.cowork}
          privateOfficeSectionId={landingPageSectionIds.privateOffice}
        />

        <LandingPagePricingContactSection
          locale={locale}
          pricingSectionId={landingPageSectionIds.pricing}
          faqContactSectionId={landingPageSectionIds.faqContact}
          deskohubBarCtaHref={localizedHash(
            `#${landingPageSectionIds.overview}`
          )}
          contactAddress={contactAddress}
          contactEmail={contactEmail}
          contactPhone={contactPhone}
        />
      </main>
    </>
  );
}
