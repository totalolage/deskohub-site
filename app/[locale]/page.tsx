import { Contact } from "@/features/contact";
import { GamesGallery } from "@/features/gallery";
import { AboutSection, HomeHero, PartnersBanner, Stats } from "@/features/home";
import { m, setLocale } from "@/features/i18n";
import { Location } from "@/features/location";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "./route";

export const generateMetadata = metadata({
  title: m.pageTitle(),
  description: m.pageDescription(),
});

export default async function LandingPage({ params }: RouteProps_locale) {
  // Locale needs to be set here to properly refresh component tree when locale changes
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return (
    <>
      <HomeHero />
      <AboutSection tags="Domovská stránka" />
      <Stats />
      <GamesGallery />
      <Location />
      <Contact />
      <PartnersBanner />
    </>
  );
}
