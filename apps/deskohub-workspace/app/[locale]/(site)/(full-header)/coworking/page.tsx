import { PublicOfferingsStructuredData } from "@/features/checkout/components/public-offerings-structured-data";
import { CoworkingPage } from "@/features/cowork/components/coworking-page";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { getCloudinaryImages } from "@/features/gallery/backend/get-cloudinary-images.server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { loadSharedPriceList } from "@/features/pricing/backend/price-list.server";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

// The home page carousel's photos, read with the same arguments so both
// pages share one cached Cloudinary listing.
const getCoworkingPhotos = () =>
  getCloudinaryImages({
    tags: ["landing-carousel"],
    maxResults: 20,
  }).catch((): readonly CloudinaryAsset[] => []);

export const generateMetadata = publicPageMetadata("/coworking");

export default async function LocalizedCoworkingPage() {
  return runWithRequestLocale(async (locale) => {
    const [photos, priceList] = await Promise.all([
      getCoworkingPhotos(),
      loadSharedPriceList(locale),
    ]);
    const offerings = priceList.offerings.filter(
      ({ kind }) => kind === "cowork"
    );

    return (
      <>
        <PublicOfferingsStructuredData locale={locale} offerings={offerings} />
        <CoworkingPage locale={locale} offerings={offerings} photos={photos} />
      </>
    );
  });
}
