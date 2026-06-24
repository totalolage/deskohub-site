import { getCloudinaryImageUrl } from "@deskohub/cloudinary-image/url";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

const galleryImageSize = 960;
const lightboxImageSize = 1920;

export type GalleryPhoto = {
  id: string;
  publicId: string;
  src: string;
  fullSrc: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
};

export function toGalleryPhotos(
  assets: readonly CloudinaryAsset[]
): readonly GalleryPhoto[] {
  return assets.flatMap((asset) => {
    if (asset.width <= 0 || asset.height <= 0) {
      return [];
    }

    const caption = asset.context?.custom?.caption?.trim();
    const alt =
      asset.context?.custom?.alt?.trim() ||
      caption ||
      asset.public_id.split("/").at(-1)?.replaceAll("-", " ") ||
      "Deskohub Workspace gallery photo";

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
