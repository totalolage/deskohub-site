"use client";

import { CldImage, type CldImageProps } from "next-cloudinary";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

interface CloudinaryImageProps extends Omit<CldImageProps, "src" | "alt"> {
  asset: CloudinaryAsset;
  variant?: "hero" | "gallery" | "thumbnail" | "full";
}

/**
 * Unified client component for rendering Cloudinary images
 * Handles all the client-side requirements for next-cloudinary
 */
export function CloudinaryImage({
  asset,
  variant = "gallery",
  ...props
}: CloudinaryImageProps) {
  const variantConfig = {
    hero: {
      fill: true,
      priority: true,
      sizes: "100vw",
      format: "auto",
      quality: "auto",
      className: "object-cover brightness-50 absolute inset-0 z-0",
    },
    gallery: {
      width: 600,
      height: 600,
      crop: "fill" as const,
      gravity: "auto" as const,
      className: "w-full h-full object-cover",
      priority: true,
    },
    thumbnail: {
      width: 400,
      height: 400,
      crop: "fill" as const,
      gravity: "auto" as const,
      className:
        "w-full h-full object-cover group-hover:scale-105 transition-transform duration-300",
    },
    full: {
      width: 1920,
      height: 1080,
      crop: "limit" as const,
      quality: "auto",
      format: "auto",
    },
  };

  const defaultProps = variantConfig[variant] || {};

  return (
    <CldImage
      src={asset.public_id}
      alt={asset.context?.custom?.alt || asset.public_id}
      {...defaultProps}
      {...props}
    />
  );
}
