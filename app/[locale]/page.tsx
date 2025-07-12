import { Contact } from "@/features/contact";
import { Gallery, GamesGallery } from "@/features/gallery";
import { HomeHero, Stats } from "@/features/home";
import { Location } from "@/features/location";
import { m, setLocale } from "@/i18n";
import type { RouteProps_locale } from "./route";
import { metadata } from "@/shared/utils/metadata";

export const generateMetadata = metadata({
  title: m["pageTitle"](),
  description: m["pageDescription"](),
})

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
