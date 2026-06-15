import type { CloudinaryAsset } from "../backend/cloudinary.service";

export type GalleryPhoto = {
  id: string;
  publicId: string;
  src: string;
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
        src: asset.secure_url,
        width: asset.width,
        height: asset.height,
        alt,
        caption,
      },
    ];
  });
}
