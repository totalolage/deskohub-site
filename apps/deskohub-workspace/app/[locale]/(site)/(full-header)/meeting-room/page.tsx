import { PublicOfferingsStructuredData } from "@/features/checkout/components/public-offerings-structured-data";
import { loadVenuePhotos } from "@/features/gallery/backend/load-venue-photos.server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { MeetingRoomPage } from "@/features/meeting-room/components/meeting-room-page";
import { loadSharedPriceList } from "@/features/pricing/backend/price-list.server";
import {
  publicPageMetadata,
  requirePublishedPublicPage,
} from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

export const generateMetadata = publicPageMetadata("/meeting-room");

export default async function LocalizedMeetingRoomPage() {
  return runWithRequestLocale(async (locale) => {
    await requirePublishedPublicPage("/meeting-room");
    const [heroImages, galleryImages, priceList] = await Promise.all([
      loadVenuePhotos("meeting-room-hero", locale),
      loadVenuePhotos("meeting-room-gallery", locale),
      loadSharedPriceList(locale),
    ]);

    return (
      <>
        <PublicOfferingsStructuredData
          locale={locale}
          offerings={priceList.offerings.filter(
            ({ kind }) => kind === "meeting-room"
          )}
        />
        <MeetingRoomPage
          galleryImages={galleryImages}
          heroImage={heroImages[0]}
          locale={locale}
        />
      </>
    );
  });
}
