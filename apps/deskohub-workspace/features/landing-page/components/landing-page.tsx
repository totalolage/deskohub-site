import type { Locale } from "@/features/i18n";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import { workspaceSiteConstants } from "@/shared/utils";
import { LandingPageExperiencesSection } from "./landing-page-experiences-section";
import { LandingPageFaqContactSection } from "./landing-page-faq-contact-section";
import { LandingPageHeroSection } from "./landing-page-hero-section";
import { LandingPageTeambuildingsSection } from "./landing-page-teambuildings-section";
import { LandingPageUniverseSection } from "./landing-page-universe-section";
import { LandingPageWorkspaceSection } from "./landing-page-workspace-section";

type LandingPageProps = {
  locale: Locale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const contactHref = `${localePath}/contact`;
  const reservationHref = `${localePath}/checkout/order`;
  const contactAddress = workspaceSiteConstants.contact.address;
  const contactEmail = workspaceSiteConstants.contact.infoEmail;

  return (
    <main className="overflow-x-clip bg-navy-blue">
      <LandingPageHeroSection
        locale={locale}
        overviewSectionId={siteHeaderSectionIds.overview}
        reservationHref={reservationHref}
        eventsHref={localizedHash(`#${siteHeaderSectionIds.events}`)}
      />

      <LandingPageUniverseSection locale={locale} />

      <LandingPageWorkspaceSection
        locale={locale}
        coworkSectionId={siteHeaderSectionIds.cowork}
        privateOfficeSectionId={siteHeaderSectionIds.privateOffice}
        contactEmail={contactEmail}
      />

      <LandingPageExperiencesSection
        locale={locale}
        ttrpgSectionId={siteHeaderSectionIds.ttrpg}
        eventsSectionId={siteHeaderSectionIds.events}
        contactHref={contactHref}
      />

      <LandingPageTeambuildingsSection
        locale={locale}
        teambuildingsSectionId={siteHeaderSectionIds.teambuildings}
        contactHref={contactHref}
      />

      <LandingPageFaqContactSection
        locale={locale}
        faqContactSectionId={siteHeaderSectionIds.faqContact}
        contactHref={contactHref}
        deskohubBarCtaHref={localizedHash(`#${siteHeaderSectionIds.overview}`)}
        contactAddress={contactAddress}
        contactEmail={contactEmail}
      />
    </main>
  );
}
