import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { CloudinaryImage } from "@/features/gallery/components/cloudinary-image";
import type { CloudinaryTag } from "@/features/gallery/types/cloudinary-tag";
import { m } from "@/i18n";
import { Price } from "@/shared/components/price";
import { siteConstants } from "@/shared/utils/constants";

/**
 * About section with venue images and pricing information
 * Used on the homepage to showcase the venue and entry fees
 */
export async function AboutSection({ tags }: { tags: CloudinaryTag }) {
  // Fetch images with combined galerie + page tag
  const images = await getCloudinaryImages({
    tags: [["galerie", tags]],
  });

  return (
    <section className="py-16 bg-amber-50">
      <div className="max-w-7xl mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
          {images.slice(0, 3).map((image) => (
            <div
              key={image.public_id}
              className="rounded-full overflow-hidden aspect-square"
            >
              <CloudinaryImage asset={image} variant="gallery" />
            </div>
          ))}
        </div>

        <div className="text-center max-w-4xl mx-auto">
          <p className="text-lg text-gray-700 leading-relaxed">
            {m["about.description"]()}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-4">
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withPurchase"]()}
                &nbsp;
                <Price
                  amount={siteConstants.pricing.entryFee.withPurchase}
                  className="text-green-600 font-bold"
                />
              </span>
            </div>
            <div className="bg-white rounded-lg shadow-sm px-6 py-3">
              <span className="text-gray-700">
                {m["about.priceInfo.withoutPurchase"]()}
                &nbsp;
                <Price
                  amount={siteConstants.pricing.entryFee.withoutPurchase}
                  className="text-green-600 font-bold"
                />
              </span>
            </div>
            <div className="bg-green-100 rounded-lg shadow-sm px-6 py-3">
              <span className="text-green-800 font-medium">
                {m["about.priceInfo.childrenFree"]()}
              </span>
            </div>
            <div className="bg-green-100 rounded-lg shadow-sm px-6 py-3">
              <span className="text-green-800 font-medium">
                {m["about.priceInfo.mondayFree"]()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
