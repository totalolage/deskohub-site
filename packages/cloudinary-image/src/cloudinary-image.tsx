"use client";

import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CldImage, type CldImageProps } from "next-cloudinary";

type ImageSize = number | "fill";
type CloudinaryImageVariant = "hero" | "gallery" | "thumbnail" | "full";

type CloudinaryImageProps = Omit<
  CldImageProps,
  "src" | "alt" | "width" | "height" | "fill"
> & {
  source: CloudinaryAsset | string;
  /** Describes the image for its context; pass "" only for a decorative image. */
  alt: string;
  variant?: CloudinaryImageVariant;
  size?: {
    width: ImageSize;
    height: ImageSize;
  };
};

interface VariantConfig {
  size: Record<"width" | "height", ImageSize>;
  preload?: boolean;
  crop: "fill" | "limit";
  className?: string;
}

const variantConfig: Record<CloudinaryImageVariant, VariantConfig> = {
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

/** How each crop mode fits the image into its box. */
const cropFit = {
  fill: { className: "object-cover", fit: "cover" },
  limit: { className: "object-contain", fit: "contain" },
} as const satisfies Record<
  VariantConfig["crop"],
  { className: string; fit: "cover" | "contain" }
>;

const classNames = (...values: Array<string | undefined>) =>
  values.filter(Boolean).join(" ");

type ImageDimensions = { fill: true } | { width: number; height: number };

const isFillSize = (size: VariantConfig["size"]) =>
  size.width === "fill" || size.height === "fill";

const imageDimensions = (
  size: VariantConfig["size"],
  fill: boolean
): ImageDimensions =>
  fill || typeof size.width !== "number" || typeof size.height !== "number"
    ? { fill: true }
    : { width: size.width, height: size.height };

/** The sizing, loading, and crop props a variant passes to `CldImage`. */
const variantImageProps = (
  config: VariantConfig,
  {
    size,
    preload,
    priority,
    sizes,
  }: Pick<CloudinaryImageProps, "size" | "preload" | "priority" | "sizes">
): Pick<VariantConfig, "crop"> &
  Pick<CldImageProps, "preload" | "sizes"> &
  ImageDimensions => {
  const imageSize = size || config.size;
  const {
    size: _,
    className: __,
    preload: variantPreload,
    ...restConfig
  } = config;
  const fill = isFillSize(imageSize);

  return {
    ...restConfig,
    preload: preload ?? priority ?? variantPreload,
    sizes: fill ? (sizes ?? "100vw") : sizes,
    ...imageDimensions(imageSize, fill),
  };
};

export function CloudinaryImage({
  source,
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
  const fit = cropFit[config.crop];

  return (
    <CldImage
      src={typeof source === "string" ? source : source.public_id}
      alt={alt}
      blurDataURL={blurDataURL}
      placeholder={blurDataURL ? "blur" : "empty"}
      className={classNames(config.className, fit.className, className)}
      style={{ backgroundSize: fit.fit, objectFit: fit.fit, ...style }}
      {...variantImageProps(config, { size, preload, priority, sizes })}
      {...props}
    />
  );
}
