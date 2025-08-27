import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Gallery } from "@/features/gallery";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { m, setLocale } from "@/i18n";
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
  setLocale((await params).locale);

  return (
    <>
      {/* Hero Section */}
      <Hero tags='Školící místnost' alignment="center">
        <div className="container mx-auto px-4 py-16">
          <Link href="/training-room" className="inline-flex mb-8">
            <Button
              variant="outline"
              className="gap-2 bg-white/90 backdrop-blur"
            >
              <ChevronLeft className="h-4 w-4" />
              {m["training.gallery.backToTraining"]()}
            </Button>
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4 drop-shadow-lg">
            {m["training.gallery.title"]()}
          </h1>
          <p className="text-lg md:text-xl text-white/90 max-w-3xl mx-auto drop-shadow-lg">
            {m["training.gallery.description"]()}
          </p>
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
