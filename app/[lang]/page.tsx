import { Contact } from "@/components/sections/contact";
import { Gallery } from "@/components/sections/gallery";
import { GamesGallery } from "@/components/sections/games-gallery";
import { Hero } from "@/components/sections/hero";
import { Location } from "@/components/sections/location";
import { Stats } from "@/components/sections/stats";
import { setLocale } from "@/i18n";
import type { PropsWithLocale } from "./route";

export default async function Component({ params }: PropsWithLocale) {
  const { lang } = await params;
  setLocale(lang, { reload: false });

  return (
    <>
      <Hero />
      <Gallery />
      <Stats />
      <GamesGallery />
      <Location />
      <Contact />
    </>
  );
}
