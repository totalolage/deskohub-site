import { Contact } from "@/features/contact";
import { Gallery, GamesGallery } from "@/features/gallery";
import { HomeHero, Stats } from "@/features/home";
import { Location } from "@/features/location";
import { setLocale } from "@/i18n";
import type { RouteProps_locale } from "./route";

export default async function LandingPage({ params }: RouteProps_locale) {
  setLocale((await params).locale, { reload: false });

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
