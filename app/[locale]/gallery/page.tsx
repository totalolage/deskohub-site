import {
  GalleryEvents,
  GalleryHero,
  GallerySpaces,
  MinimalGallery,
} from "@/features/gallery";
import { m, setLocale } from "@/i18n";
import { siteConstants } from "@/shared/utils/constants";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["gallery.pageTitle"](),
  description: m["gallery.pageDescription"](),
});

export default async function GalleryPage({ params }: RouteProps_locale) {
  setLocale((await params).locale);
  const useFancyGallery = siteConstants.featureFlags.gallery;

  if (useFancyGallery) {
    return (
      <>
        <GalleryHero />
        <GallerySpaces />
        <GalleryEvents />
      </>
    );
  }

  return <MinimalGallery />;
}
