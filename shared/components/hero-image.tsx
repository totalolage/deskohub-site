"use client";

import { CldImage } from "next-cloudinary";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";

interface HeroImageProps {
  image: CloudinaryAsset | null | undefined;
}

export function HeroImage({ image }: HeroImageProps) {
  if (!image) return null;

  return (
    <CldImage
      src={image.secure_url || image.url}
      alt={image.context?.custom?.alt || image.public_id}
      fill
      className="object-cover brightness-50 absolute inset-0 z-0"
      priority
      sizes="100vw"
      format="auto"
      quality="auto"
    />
  );
}
