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
    src: asset.public_id,
    width,
  });
}
