import { GalleryCollection, MinimalGallery } from "@/features/gallery";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
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

  if (!siteConstants.featureFlags.gallery) return <MinimalGallery />;

  return (
    <GalleryCollection
      imagesPromise={getCloudinaryImages({
        searchType: "tag",
        searchValue: "výběr",
      })}
    />
  );
}
