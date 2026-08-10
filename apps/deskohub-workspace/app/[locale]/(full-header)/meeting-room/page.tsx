import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { MeetingRoomPage } from "@/features/meeting-room/components/meeting-room-page";
import { MeetingRoomPageFeature } from "@/features/meeting-room/components/meeting-room-page-feature";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

const pathname = "/meeting-room";

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

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale(async (locale) => {
    if (!(await isMeetingRoomPageEnabled())) notFound();

    const title = m.meetingRoomMetadataTitle({}, { locale });
    const description = m.meetingRoomMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, pathname);

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, pathname),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export default async function LocalizedMeetingRoomPage() {
  return runWithRequestLocale(async (locale) => {
    const meetingRoomPageEnabled = await isMeetingRoomPageEnabled();
    if (!meetingRoomPageEnabled) notFound();
    const [heroImages, galleryImages] = await Promise.all([
      getMeetingRoomHeroImages(),
      getMeetingRoomGalleryImages(),
    ]);

    return (
      <MeetingRoomPageFeature initialEnabled={meetingRoomPageEnabled}>
        <MeetingRoomPage
          galleryImages={galleryImages}
          heroImage={heroImages[0]}
          locale={locale}
        />
      </MeetingRoomPageFeature>
    );
  });
}
