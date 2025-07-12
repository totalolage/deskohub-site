import { Contact } from "@/features/contact";
import { Gallery, GamesGallery } from "@/features/gallery";
import { HomeHero, Stats } from "@/features/home";
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
      <Gallery />
      <Stats />
      <GamesGallery />
      <Location />
      <Contact />
    </>
  );
}
