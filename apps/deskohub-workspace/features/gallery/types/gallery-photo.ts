import type { CloudinaryPublicId } from "@deskohub/cloudinary/schema";
import { getCloudinaryImageUrl } from "@deskohub/cloudinary-image/url";
import type { Locale } from "@/features/i18n";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { getLocalizedCloudinaryContextValue } from "./localized-cloudinary-context";

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
  getFallbackAlt: (index: number) => string = (index) =>
    `Deskohub Workspace gallery photo ${index + 1}`
): readonly GalleryPhoto[] {
  return assets.flatMap((asset, index) => {
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
      getFallbackAlt(index);

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
