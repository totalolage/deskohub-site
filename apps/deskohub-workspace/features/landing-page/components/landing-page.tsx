import type { Locale } from "@/features/i18n";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import { LandingPageContactSection } from "./landing-page-contact-section";
import { LandingPageHero } from "./landing-page-hero";
import { landingPageHeroVars } from "./landing-page-hero-section";
import { LandingPageLocationMapSection } from "./landing-page-location-map-section";
import { LandingPagePhotoCarouselSection } from "./landing-page-photo-carousel-section";

type LandingPageProps = {
  locale: Locale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
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

      <LandingPageContactSection
        locale={locale}
        contactHref={contactHref}
        deskohubBarCtaHref={localizedHash(`#${siteHeaderSectionIds.overview}`)}
      />
    </main>
  );
}
