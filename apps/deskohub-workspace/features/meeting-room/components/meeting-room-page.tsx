import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import type { Locale } from "@/features/i18n";
import { MeetingRoomGallery } from "./meeting-room-gallery";
import { MeetingRoomHero } from "./meeting-room-hero";
import { MeetingRoomSpecifications } from "./meeting-room-specifications";

type MeetingRoomPageProps = {
  galleryImages: readonly CloudinaryAsset[];
  heroImage?: CloudinaryAsset;
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
    </main>
  );
}
