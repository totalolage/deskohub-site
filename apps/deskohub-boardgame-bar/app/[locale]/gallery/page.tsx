import { Gallery } from "@/features/gallery";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { GalleryHeader } from "@/features/gallery/components/gallery-header";
import { m, setLocale } from "@/features/i18n";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../route";

export const generateMetadata = metadata({
  title: m["gallery.pageTitle"](),
  description: m["gallery.pageDescription"](),
});

export default async function GalleryPage({ params }: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return (
    <>
      <GalleryHeader
        imagesPromise={getCloudinaryImages({ tags: [["Web galerie", "hero"]] })}
        title={m["gallery.hero.title"]()}
        description={m["gallery.pageDescription"]()}
      />

      <section className="py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <Gallery
            imagesPromise={getCloudinaryImages({
              tags: [["Web galerie", "galerie"]],
            })}
            variant="grid"
            enableLightbox={true}
          />
        </div>
      </section>
    </>
  );
}
