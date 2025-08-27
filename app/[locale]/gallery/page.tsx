import { Gallery } from "@/features/gallery";
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
    <section className="py-16 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold mb-4">
            {m["gallery.hero.title"]()}
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            {m["gallery.pageDescription"]()}
          </p>
        </div>
        <Gallery tags={["Web galerie"]} variant="grid" enableLightbox={true} />
      </div>
    </section>
  );
}
