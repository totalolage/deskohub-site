"use client";

import { track } from "@vercel/analytics";
import Image from "next/image";
import { use, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";
import { getCldImageUrl } from "next-cloudinary";
import { CloudinaryImage } from "./cloudinary-image";
import type { CloudinaryAssetWithBlur } from "./gallery";

interface ClientGalleryProps {
  imagesPromise: Promise<readonly CloudinaryAssetWithBlur[]>;
  variant?: "grid" | "minimal";
  columns?: {
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  maxImages?: number;
  enableLightbox?: boolean;
  className?: string;
}

/**
 * Client component that displays Cloudinary images with lightbox support
 */
export function ClientGallery({
  imagesPromise,
  variant = "grid",
  columns = { sm: 2, md: 3, lg: 4 },
  enableLightbox = true,
  className = "",
}: ClientGalleryProps) {
  const images = use(imagesPromise);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  if (variant === "minimal") {
    if (!images.length) return null;
    return (
      <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${className}`}>
        {images.map((image) => (
          <div
            key={image.public_id}
            className="rounded-full overflow-hidden aspect-square"
          >
            <CloudinaryImage asset={image} variant="gallery" />
          </div>
        ))}
      </div>
    );
  }

  if (!images.length) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No images available at the moment.</p>
      </div>
    );
  }

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          columns.sm && `sm:grid-cols-${columns.sm}`,
          columns.md && `md:grid-cols-${columns.md}`,
          columns.lg && `lg:grid-cols-${columns.lg}`,
          columns.xl && `xl:grid-cols-${columns.xl}`,
          className
        )}
      >
        {images.map((image, index) => (
          <Card
            key={image.public_id}
            className="overflow-hidden transition-shadow hover:shadow-lg cursor-pointer group"
            onClick={() => {
              if (enableLightbox) {
                setLightboxIndex(index);
                setLightboxOpen(true);
                const trackData: Record<string, string | number> = {
                  imageId: image.public_id,
                  imageIndex: index,
                };
                if (image.context?.custom?.caption) {
                  trackData.imageCaption = image.context.custom.caption;
                }
                track("Gallery Lightbox Open", trackData);
              }
            }}
          >
            <div className="relative aspect-square overflow-hidden">
              <CloudinaryImage asset={image} variant="thumbnail" />
            </div>
            {image.context?.custom?.caption && (
              <div className="p-3">
                <p className="text-sm text-gray-600">
                  {image.context.custom.caption}
                </p>
              </div>
            )}
          </Card>
        ))}
      </div>

      {enableLightbox && (
        <Lightbox
          open={lightboxOpen}
          close={() => setLightboxOpen(false)}
          index={lightboxIndex}
          slides={images.map((image, index) => ({
            src: String(index), // We use index to reference back to the image
            alt: image.context?.custom?.alt || image.public_id,
            title: image.context?.custom?.caption,
          }))}
          render={{
            slide: ({ slide, rect }) => {
              const image = images[Number(slide.src)];
              if (!image) return null;

              // Generate optimized URL for the lightbox
              const imageUrl = getCldImageUrl({
                src: image.public_id,
                width: rect.width,
                height: rect.height,
                crop: "limit",
                quality: "auto",
                format: "auto",
              });

              // Check if image has a blur data URL
              const hasBlur = image.blurDataUrl !== undefined;

              return (
                <Image
                  src={imageUrl}
                  alt={slide.alt || image.public_id}
                  width={rect.width}
                  height={rect.height}
                  placeholder={hasBlur ? "blur" : "empty"}
                  blurDataURL={hasBlur ? image.blurDataUrl : undefined}
                  style={{
                    width: rect.width,
                    height: rect.height,
                    objectFit: "contain",
                  }}
                  unoptimized // Since Cloudinary already optimizes
                />
              );
            },
          }}
        />
      )}
    </>
  );
}
