import { Contact } from "@/features/contact";
import { GamesGallery } from "@/features/gallery";
import { AboutSection, HomeHero, Stats } from "@/features/home";
import { Location } from "@/features/location";
import { m, setLocale } from "@/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "./route";

export const generateMetadata = metadata({
  title: m.pageTitle(),
  description: m.pageDescription(),
});

export default async function LandingPage({ params }: RouteProps_locale) {
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
    </>
  );
}
