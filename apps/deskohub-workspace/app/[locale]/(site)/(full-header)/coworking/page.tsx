import { PublicOfferingsStructuredData } from "@/features/checkout/components/public-offerings-structured-data";
import { CoworkingPage } from "@/features/cowork/components/coworking-page";
import { loadVenuePhotos } from "@/features/gallery/backend/load-venue-photos.server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { loadSharedPriceList } from "@/features/pricing/backend/price-list.server";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export const generateMetadata = publicPageMetadata("/coworking");

export default async function LocalizedCoworkingPage() {
  return runWithRequestLocale(async (locale) => {
    const [photos, priceList] = await Promise.all([
      loadVenuePhotos("coworking", locale),
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
