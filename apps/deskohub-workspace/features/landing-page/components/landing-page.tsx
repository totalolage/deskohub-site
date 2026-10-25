import type { Locale } from "@/features/i18n";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import { getDeskohubBarPageUrl } from "@/shared/utils";
import { LandingPageAmenitiesSection } from "./landing-page-amenities-section";
import { LandingPageContactSection } from "./landing-page-contact-section";
import { LandingPageFaqTeaserSection } from "./landing-page-faq-teaser-section";
import { LandingPageHero } from "./landing-page-hero";
import { landingPageHeroVars } from "./landing-page-hero-section";
import { LandingPageLocationMapSection } from "./landing-page-location-map-section";
import { LandingPageOfferingSection } from "./landing-page-offering-section";
import { LandingPagePhotoCarouselSection } from "./landing-page-photo-carousel-section";

type LandingPageProps = {
  locale: Locale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const contactHref = `${localePath}/contact`;

  return (
    <main className="overflow-x-clip bg-navy-blue" style={landingPageHeroVars}>
      <LandingPageHero
        locale={locale}
        overviewSectionId={siteHeaderSectionIds.overview}
      />

      <LandingPagePhotoCarouselSection locale={locale} />

      <LandingPageLocationMapSection
        locale={locale}
        locationMapSectionId={siteHeaderSectionIds.locationMap}
      />

      {/* Legacy event/TTRPG hashes land on the offering, which covers both. */}
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

      <LandingPageOfferingSection locale={locale} />

      <LandingPageAmenitiesSection locale={locale} />

      <LandingPageFaqTeaserSection locale={locale} />

      <LandingPageContactSection
        locale={locale}
        contactHref={contactHref}
        deskohubBarCtaHref={getDeskohubBarPageUrl({ locale })}
      />
    </main>
  );
}
