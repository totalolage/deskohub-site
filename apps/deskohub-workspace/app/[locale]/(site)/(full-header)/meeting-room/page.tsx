import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { getCloudinaryImages } from "@/features/gallery/backend/get-cloudinary-images.server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { MeetingRoomPage } from "@/features/meeting-room/components/meeting-room-page";
import {
  publicPageMetadata,
  requirePublishedPublicPage,
} from "@/features/public-pages/backend/public-page-route.server";

export const instant = false;

const getMeetingRoomHeroImages = () =>
  getCloudinaryImages({
    maxResults: 1,
    tags: "meeting-room-hero",
  }).catch((): readonly CloudinaryAsset[] => []);

const getMeetingRoomGalleryImages = () =>
  getCloudinaryImages({
    sortBy: "public_id",
    sortDirection: "asc",
    tags: "meeting-room-gallery",
  }).catch((): readonly CloudinaryAsset[] => []);

export const generateMetadata = publicPageMetadata("/meeting-room");

export default async function LocalizedMeetingRoomPage() {
  return runWithRequestLocale(async (locale) => {
    await requirePublishedPublicPage("/meeting-room");
    const [heroImages, galleryImages] = await Promise.all([
      getMeetingRoomHeroImages(),
      getMeetingRoomGalleryImages(),
    ]);

    return (
      <MeetingRoomPage
        galleryImages={galleryImages}
        heroImage={heroImages[0]}
        locale={locale}
      />
    );
  });
}
