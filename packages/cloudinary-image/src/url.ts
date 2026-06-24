import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { getCldImageUrl } from "next-cloudinary";

export function getCloudinaryImageUrl({
  asset,
  height,
  width,
}: {
  asset: CloudinaryAsset;
  height: number;
  width: number;
}) {
  return getCldImageUrl({
    crop: "limit",
    format: "auto",
    height,
    quality: "auto",
    // Preserve Cloudinary's version segment so overwritten assets bust caches.
    src: asset.secure_url,
    width,
  });
}
