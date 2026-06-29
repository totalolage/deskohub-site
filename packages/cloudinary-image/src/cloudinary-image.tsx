"use client";

import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CldImage, type CldImageProps } from "next-cloudinary";

type ImageSize = number | "fill";
type CloudinaryImageVariant = "hero" | "gallery" | "thumbnail" | "full";

interface CloudinaryImageProps
  extends Omit<CldImageProps, "src" | "alt" | "width" | "height" | "fill"> {
  asset: CloudinaryAsset;
  alt?: string;
  variant?: CloudinaryImageVariant;
  size?: {
    width: ImageSize;
    height: ImageSize;
  };
}

const variantConfig: Record<
  CloudinaryImageVariant,
  {
    size: Record<"width" | "height", ImageSize>;
    preload?: boolean;
    crop: "fill" | "limit";
    className?: string;
  }
> = {
  hero: {
    size: { width: "fill", height: "fill" },
    preload: true,
    crop: "fill",
    className: "brightness-50 absolute inset-0 z-0",
  },
  gallery: {
    size: { width: 600, height: 600 },
    crop: "fill",
    className: "w-full h-full",
    preload: true,
  },
  thumbnail: {
    size: { width: 400, height: 400 },
    crop: "fill",
    className:
      "w-full h-full group-hover:scale-105 transition-transform duration-300",
  },
  full: {
    size: { width: 1920, height: 1080 },
    crop: "limit",
  },
};

const classNames = (...values: Array<string | undefined>) =>
  values.filter(Boolean).join(" ");

export function CloudinaryImage({
  asset,
  alt,
  variant = "gallery",
  size,
  blurDataURL,
  className,
  preload,
  priority,
  sizes,
  style,
  ...props
}: CloudinaryImageProps) {
  const config = variantConfig[variant];
  const objectFit = config.crop === "fill" ? "object-cover" : "object-contain";
  const finalClassName = classNames(config.className, objectFit, className);
  const imageSize = size || config.size;
  const {
    size: _,
    className: __,
    preload: variantPreload,
    ...restConfig
  } = config;
  const useFill = imageSize.width === "fill" || imageSize.height === "fill";
  const finalPreload = preload ?? priority ?? variantPreload;
  const finalSizes = useFill ? (sizes ?? "100vw") : sizes;

  type FinalProps = typeof restConfig &
    Pick<CldImageProps, "preload" | "sizes"> &
    ({ fill: true } | { width: number; height: number });

  const sharedProps = {
    ...restConfig,
    preload: finalPreload,
    sizes: finalSizes,
  };
  const finalProps: FinalProps =
    useFill ||
    typeof imageSize.width !== "number" ||
    typeof imageSize.height !== "number"
      ? { ...sharedProps, fill: true }
      : { ...sharedProps, width: imageSize.width, height: imageSize.height };

  const positioningStyle: CldImageProps["style"] = {
    backgroundSize: config.crop === "fill" ? "cover" : "contain",
    objectFit: config.crop === "fill" ? "cover" : "contain",
    ...style,
  };
  const fallbackAlt = asset.context?.custom?.alt?.trim() || asset.public_id;

  return (
    <CldImage
      src={asset.public_id}
      alt={alt ?? fallbackAlt}
      blurDataURL={blurDataURL}
      placeholder={blurDataURL ? "blur" : "empty"}
      className={finalClassName}
      style={positioningStyle}
      {...finalProps}
      {...props}
    />
  );
}
