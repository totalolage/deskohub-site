import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Gallery } from "@/features/gallery";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { m, setLocale } from "@/features/i18n";
import { Hero } from "@/shared/components/hero";
import { Button } from "@/shared/components/ui/button";
import { metadata } from "@/shared/utils/metadata";
import type { RouteProps_locale } from "../../route";

export const generateMetadata = metadata({
  title: m["training.gallery.pageTitle"](),
  description: m["training.gallery.pageDescription"](),
});

export default async function TrainingRoomGalleryPage({
  params,
}: RouteProps_locale) {
  const { locale } = await params;
  setLocale(locale, { reload: false });

  return (
    <>
      {/* Hero Section */}
      <Hero tags="Školící místnost" alignment="left">
        <div className="space-y-4">
          <h1 className="text-4xl md:text-5xl font-bold text-green-400 drop-shadow-lg">
            {m["training.gallery.title"]()}
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-[60ch] drop-shadow-lg">
            {m["training.gallery.description"]()}
          </p>
          <Link href="/training-room" className="inline-flex mb-8">
            <Button
              variant="outline"
              className="gap-2 bg-white/90 backdrop-blur"
            >
              <ChevronLeft className="h-4 w-4" />
              {m["training.gallery.backToTraining"]()}
            </Button>
          </Link>
        </div>
      </Hero>

      {/* Gallery Section */}
      <section className="py-16 px-4">
        <div className="max-w-7xl mx-auto">
          <Gallery
            imagesPromise={getCloudinaryImages({
              tags: [["Školící místnost", "galerie"]],
              maxResults: 50,
            })}
            variant="grid"
            enableLightbox={true}
            columns={{ sm: 2, md: 3, lg: 4 }}
          />
        </div>
      </section>
    </>
  );
}
