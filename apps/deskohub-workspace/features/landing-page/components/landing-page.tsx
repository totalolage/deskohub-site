import type { Locale } from "@/features/i18n";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import { workspaceSiteConstants } from "@/shared/utils";
import { LandingPageFaqContactSection } from "./landing-page-faq-contact-section";
import {
  LandingPageHeroSection,
  landingPageHeroVars,
} from "./landing-page-hero-section";
import { LandingPageLocationMapSection } from "./landing-page-location-map-section";
import { LandingPagePhotoCarouselSection } from "./landing-page-photo-carousel-section";
import { LandingPageTeambuildingsSection } from "./landing-page-teambuildings-section";
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
    <main className="overflow-x-clip bg-navy-blue" style={landingPageHeroVars}>
      <LandingPageHeroSection
        locale={locale}
        overviewSectionId={siteHeaderSectionIds.overview}
        reservationHref={reservationHref}
        eventsHref={contactHref}
      />

      <LandingPagePhotoCarouselSection />

      <LandingPageLocationMapSection
        locale={locale}
        locationMapSectionId={siteHeaderSectionIds.locationMap}
      />

      <LandingPageWorkspaceSection
        locale={locale}
        coworkSectionId={siteHeaderSectionIds.cowork}
        privateOfficeSectionId={siteHeaderSectionIds.privateOffice}
        contactEmail={contactEmail}
      />

      {/* <LandingPageExperiencesSection */}
      {/*   locale={locale} */}
      {/*   ttrpgSectionId={siteHeaderSectionIds.ttrpg} */}
      {/*   eventsSectionId={siteHeaderSectionIds.events} */}
      {/*   contactHref={contactHref} */}
      {/* /> */}

      <LandingPageTeambuildingsSection
        locale={locale}
        teambuildingsSectionId={siteHeaderSectionIds.teambuildings}
        contactHref={contactHref}
      />

      {/* Legacy event/TTRPG hashes land by contact while those sections are hidden. */}
      <div
        id={siteHeaderSectionIds.events}
        aria-hidden="true"
        className="scroll-mt-[var(--anchor-scroll-offset)]"
      />
      <div
        id={siteHeaderSectionIds.ttrpg}
        aria-hidden="true"
        className="scroll-mt-[var(--anchor-scroll-offset)]"
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
