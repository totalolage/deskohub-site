import Interpolate from "@doist/react-interpolate";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { Gallery } from "@/features/gallery/components/gallery";
import type { CloudinaryTag } from "@/features/gallery/types/cloudinary-tag";
import { m } from "@/features/i18n";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";

/**
 * About section with venue images and pricing information
 * Used on the homepage to showcase the venue and consumption credit
 */
export async function AboutSection({ tags }: { tags: CloudinaryTag }) {
  const imagesPromise = getCloudinaryImages({
    tags: [["galerie", tags]],
  });

  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6">
        <Gallery
          imagesPromise={imagesPromise}
          variant="minimal"
          className="mb-16"
        />

        <div className="text-center max-w-4xl mx-auto">
          <p className="text-lg text-gray-700 leading-relaxed">
            {m["about.description"]()}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                <Interpolate
                  string={m["about.priceInfo.forPlayers"]()}
                  mapping={{
                    entryFee: () => (
                      <Price
                        amount={siteConstants.pricing.entryFee}
                        className="text-green-600 font-bold"
                      />
                    ),
                    consumptionCredit: () => (
                      <Price
                        amount={siteConstants.pricing.consumptionCredit}
                        className="text-green-600 font-bold"
                      />
                    ),
                  }}
                />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
