import type { WorkspaceLocale } from "@/features/i18n";
import { siteHeaderSectionIds } from "@/shared/components/site-header-config";
import { workspaceSiteConstants } from "@/shared/utils";
import { LandingPageExperiencesSection } from "./landing-page-experiences-section";
import { LandingPageHeroSection } from "./landing-page-hero-section";
import { LandingPagePricingContactSection } from "./landing-page-pricing-contact-section";
import { LandingPageUniverseSection } from "./landing-page-universe-section";
import { LandingPageWorkspaceSection } from "./landing-page-workspace-section";

type LandingPageProps = {
  locale: WorkspaceLocale;
};

export function LandingPage({ locale }: LandingPageProps) {
  const localePath = `/${locale}`;
  const localizedHash = (hash: string) => `${localePath}${hash}`;
  const contactHref = `${localePath}/contact`;
  const contactAddress = workspaceSiteConstants.contact.address;
  const contactEmail = workspaceSiteConstants.contact.infoEmail;

  return (
    <main className="overflow-x-clip bg-navy-blue">
      <LandingPageHeroSection
        locale={locale}
        overviewSectionId={siteHeaderSectionIds.overview}
        pricingHref={localizedHash(`#${siteHeaderSectionIds.pricing}`)}
        eventsHref={localizedHash(`#${siteHeaderSectionIds.events}`)}
      />

      <LandingPageUniverseSection locale={locale} />

      <LandingPageExperiencesSection
        locale={locale}
        ttrpgSectionId={siteHeaderSectionIds.ttrpg}
        eventsSectionId={siteHeaderSectionIds.events}
        contactHref={contactHref}
      />

      <LandingPageWorkspaceSection
        locale={locale}
        coworkSectionId={siteHeaderSectionIds.cowork}
        privateOfficeSectionId={siteHeaderSectionIds.privateOffice}
        contactEmail={contactEmail}
      />

      <LandingPagePricingContactSection
        locale={locale}
        pricingSectionId={siteHeaderSectionIds.pricing}
        faqContactSectionId={siteHeaderSectionIds.faqContact}
        contactHref={contactHref}
        deskohubBarCtaHref={localizedHash(`#${siteHeaderSectionIds.overview}`)}
        contactAddress={contactAddress}
        contactEmail={contactEmail}
      />
    </main>
  );
}
