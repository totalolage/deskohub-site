"use client";

import { CldImage, type CldImageProps } from "next-cloudinary";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

type ImageSize = number | "fill";

interface CloudinaryImageProps
  extends Omit<CldImageProps, "src" | "alt" | "width" | "height" | "fill"> {
  asset: CloudinaryAsset;
  variant?: "hero" | "gallery" | "thumbnail" | "full";
  size?: {
    width: ImageSize;
    height: ImageSize;
  };
}

/**
 * Unified client component for rendering Cloudinary images
 * Handles all the client-side requirements for next-cloudinary
 */
export function CloudinaryImage({
  asset,
  variant = "gallery",
  size,
  blurDataURL,
  ...props
}: CloudinaryImageProps) {
  const variantConfig = {
    hero: {
      size: { width: "fill" as const, height: "fill" as const },
      priority: true,
      sizes: "100vw",
      format: "auto",
      quality: "auto",
      className: "object-cover brightness-50 absolute inset-0 z-0",
    },
    gallery: {
      size: { width: 600, height: 600 },
      crop: "fill" as const,
      gravity: "auto" as const,
      className: "w-full h-full object-cover",
      priority: true,
    },
    thumbnail: {
      size: { width: 400, height: 400 },
      crop: "fill" as const,
      gravity: "auto" as const,
      className:
        "w-full h-full object-cover group-hover:scale-105 transition-transform duration-300",
    },
    full: {
      size: { width: "fill" as const, height: "fill" as const },
      crop: "limit" as const,
      quality: "auto",
      format: "auto",
    },
  };

  const config = variantConfig[variant] || variantConfig.gallery;

  // Use provided size or fall back to variant's default size
  const imageSize = size || config.size;

  // Extract size config and prepare props for CldImage
  const { size: _, ...restConfig } = config;

  // Determine if we should use fill mode
  const useFill = imageSize.width === "fill" || imageSize.height === "fill";

  // Prepare final props based on whether we're using fill or dimensions
  type FinalProps = typeof restConfig &
    ({ fill: true } | { width: number; height: number });

  let finalProps: FinalProps;
  if (useFill) {
    // When using fill, don't include width or height
    finalProps = { ...restConfig, fill: true };
  } else if (
    typeof imageSize.width === "number" &&
    typeof imageSize.height === "number"
  ) {
    // When we have numeric dimensions, use them
    finalProps = {
      ...restConfig,
      width: imageSize.width,
      height: imageSize.height,
    };
  } else {
    // This shouldn't happen with proper typing, but handle gracefully
    finalProps = { ...restConfig, fill: true };
  }

  return (
    <CldImage
      src={asset.public_id}
      alt={asset.context?.custom?.alt || asset.public_id}
      blurDataURL={blurDataURL}
      placeholder={blurDataURL ? "blur" : "empty"}
      {...finalProps}
      {...props}
    />
  );
}
