import { GalleryEvents, GalleryHero, GallerySpaces } from "@/features/gallery";
import { m, setLocale } from "@/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["gallery.pageTitle"](),
  description: m["gallery.pageDescription"](),
});

export default async function GalleryPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);

  return (
    <>
      <GalleryHero />
      <GallerySpaces />
      <GalleryEvents />
    </>
  );
}
