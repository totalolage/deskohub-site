import "server-only";

import { getLocalizedCloudinaryContextValue } from "@deskohub/cloudinary-image/localized-context";
import { getCloudinaryImageUrl } from "@deskohub/cloudinary-image/url";
import { type Locale, m } from "@/features/i18n";
import type { VenuePhoto } from "../types/venue-photo";
import { getCloudinaryImages } from "./get-cloudinary-images.server";

export type VenueAlbum =
  | "gallery"
  | "landing-carousel"
  | "coworking"
  | "meeting-room-hero"
  | "meeting-room-gallery"
  | "ttrpg-room-bar"
  | "ttrpg-room-workspace";

/** Unavailable albums and assets without usable dimensions produce no photos. */
export async function loadVenuePhotos(
  album: VenueAlbum,
  locale: Locale
): Promise<readonly VenuePhoto[]> {
  const albums = {
    gallery: { tags: ["gallery"], maxResults: 80 },
    "landing-carousel": { tags: ["landing-carousel"], maxResults: 20 },
    coworking: { tags: ["landing-carousel"], maxResults: 20 },
    "meeting-room-hero": { tags: "meeting-room-hero", maxResults: 1 },
    "meeting-room-gallery": {
      tags: "meeting-room-gallery",
      sortBy: "public_id",
      sortDirection: "asc",
    },
    "ttrpg-room-bar": { tags: [["ttrpg-room", "ttrpg-room-bar"]] },
    "ttrpg-room-workspace": { tags: [["ttrpg-room", "ttrpg-room-workspace"]] },
  } as const;
  const assets = await getCloudinaryImages(albums[album]);
  const fallbackAlt = {
    gallery: m.galleryImageFallbackAlt,
    "landing-carousel": m.landingCarouselImageAlt,
    coworking: m.coworkingPhotoAlt,
    "meeting-room-hero": m.meetingRoomHeroImageAlt,
    "meeting-room-gallery": m.meetingRoomGalleryImageAlt,
    "ttrpg-room-bar": m.ttrpgRoomBarImageAlt,
    "ttrpg-room-workspace": m.ttrpgRoomWorkspaceImageAlt,
  }[album]({}, { locale });

  return assets.flatMap((asset): VenuePhoto[] => {
    if (asset.width <= 0 || asset.height <= 0) return [];

    const caption = getLocalizedCloudinaryContextValue(
      asset,
      "caption",
      locale
    );
    const detail = getLocalizedCloudinaryContextValue(asset, "detail", locale);
    const alt =
      getLocalizedCloudinaryContextValue(asset, "alt", locale) ||
      caption ||
      fallbackAlt;

    return [
      {
        id: asset.public_id,
        publicId: asset.public_id,
        src: getCloudinaryImageUrl({ asset, height: 960, width: 960 }),
        width: asset.width,
        height: asset.height,
        alt,
        caption,
        detail,
        lightbox: {
          alt,
          description: album === "meeting-room-gallery" ? detail : caption,
          height: asset.height,
          src: getCloudinaryImageUrl({ asset, height: 1920, width: 1920 }),
          title: caption,
          width: asset.width,
        },
      },
    ];
  });
}
