import type { CloudinaryPublicId } from "@deskohub/cloudinary/schema";
import { getLocalizedCloudinaryContextValue } from "@deskohub/cloudinary-image/localized-context";
import { getCloudinaryImageUrl } from "@deskohub/cloudinary-image/url";
import type { Locale } from "@/features/i18n";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

const galleryImageSize = 960;
const lightboxImageSize = 1920;

export type GalleryPhoto = {
  id: CloudinaryPublicId;
  publicId: CloudinaryPublicId;
  src: string;
  fullSrc: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
};

export function toGalleryPhotos(
  assets: readonly CloudinaryAsset[],
  locale: Locale,
  fallbackAlt: string
): readonly GalleryPhoto[] {
  return assets.flatMap((asset) => {
    if (asset.width <= 0 || asset.height <= 0) {
      return [];
    }

    const caption = getLocalizedCloudinaryContextValue(
      asset,
      "caption",
      locale
    );
    const alt =
      getLocalizedCloudinaryContextValue(asset, "alt", locale) ||
      caption ||
      fallbackAlt;

    return [
      {
        id: asset.public_id,
        publicId: asset.public_id,
        src: getCloudinaryImageUrl({
          asset,
          height: galleryImageSize,
          width: galleryImageSize,
        }),
        fullSrc: getCloudinaryImageUrl({
          asset,
          height: lightboxImageSize,
          width: lightboxImageSize,
        }),
        width: asset.width,
        height: asset.height,
        alt,
        caption,
      },
    ];
  });
}
