"use client";

import { track } from "@vercel/analytics";
import { use, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import { Card } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CloudinaryImage } from "@deskohub/cloudinary-image";

interface ClientGalleryProps {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  blurUrlsPromise?: Promise<Record<CloudinaryAsset["public_id"], string>>;
  variant?: "grid" | "minimal";
  columns?: {
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  enableLightbox?: boolean;
  className?: string;
}

/**
 * Client component that displays Cloudinary images with lightbox support
 */
export function ClientGallery({
  imagesPromise,
  blurUrlsPromise,
  variant = "grid",
  columns = { sm: 2, md: 3, lg: 4 },
  enableLightbox = true,
  className = "",
}: ClientGalleryProps) {
  const images = use(imagesPromise);
  const blurUrls = blurUrlsPromise && use(blurUrlsPromise);

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
            <CloudinaryImage
              asset={image}
              blurDataURL={blurUrls?.[image.public_id]}
              variant="gallery"
            />
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
              <CloudinaryImage
                asset={image}
                blurDataURL={blurUrls?.[image.public_id]}
                variant="thumbnail"
              />
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
          slides={images.map((_, index) => ({
            src: String(index),
          }))}
          render={{
            slide: ({ slide, rect: containerSize }) => {
              const image = images[Number(slide.src)]!;

              // Calculate the dimensions of the image to fit within the container
              const imageAspectRatio = image.width / image.height;
              const containerAspectRatio =
                containerSize.width / containerSize.height;

              let displayWidth: number;
              let displayHeight: number;

              if (imageAspectRatio > containerAspectRatio) {
                // Image is wider than container - fit to width
                displayWidth = containerSize.width;
                displayHeight = containerSize.width / imageAspectRatio;
              } else {
                // Image is taller than container - fit to height
                displayHeight = containerSize.height;
                displayWidth = containerSize.height * imageAspectRatio;
              }

              return (
                <div className="relative w-full h-full flex items-center justify-center">
                  <CloudinaryImage
                    asset={image}
                    blurDataURL={blurUrls?.[image.public_id]}
                    variant="full"
                    size={{ width: displayWidth, height: displayHeight }}
                  />
                </div>
              );
            },
          }}
        />
      )}
    </>
  );
}
