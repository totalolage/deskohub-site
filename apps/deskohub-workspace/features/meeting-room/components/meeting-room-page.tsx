import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import type { Locale } from "@/features/i18n";
import { MeetingRoomBooking } from "./meeting-room-booking";
import { MeetingRoomGallery } from "./meeting-room-gallery";
import { MeetingRoomHero } from "./meeting-room-hero";
import { MeetingRoomSpecifications } from "./meeting-room-specifications";

type MeetingRoomPageProps = {
  galleryImages: readonly VenuePhoto[];
  heroImage?: VenuePhoto;
  locale: Locale;
};

export function MeetingRoomPage({
  galleryImages,
  heroImage,
  locale,
}: MeetingRoomPageProps) {
  return (
    <main className="overflow-x-clip bg-navy-blue text-white">
      <MeetingRoomHero image={heroImage} locale={locale} />
      <MeetingRoomSpecifications locale={locale} />
      <MeetingRoomGallery images={galleryImages} locale={locale} />
      <MeetingRoomBooking locale={locale} />
    </main>
  );
}
