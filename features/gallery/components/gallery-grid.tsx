"use client";

import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { env } from "@/env";
import { Card } from "@/shared/components/ui/card";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { CloudinaryImage } from "./cloudinary-image";

interface GalleryGridProps {
  images: readonly CloudinaryAsset[];
  columns?: {
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
  enableLightbox?: boolean;
  onImageClick?: (image: CloudinaryAsset) => void;
}

export function GalleryGrid({
  images,
  columns = { sm: 2, md: 3, lg: 4 },
  enableLightbox = true,
  onImageClick,
}: GalleryGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const handleImageClick = (image: CloudinaryAsset, index: number) => {
    if (enableLightbox) {
      setLightboxIndex(index);
      setLightboxOpen(true);
    }
    onImageClick?.(image);
  };

  if (images.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No images available at the moment.</p>
      </div>
    );
  }

  // Build grid classes using standard Tailwind approach
  const gridClasses = [
    "grid",
    "grid-cols-1",
    "gap-4",
    columns.sm && `sm:grid-cols-${columns.sm}`,
    columns.md && `md:grid-cols-${columns.md}`,
    columns.lg && `lg:grid-cols-${columns.lg}`,
    columns.xl && `xl:grid-cols-${columns.xl}`,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      <div className={gridClasses}>
        {images.map((image, index) => (
          <Card
            key={image.public_id}
            className="overflow-hidden transition-shadow hover:shadow-lg cursor-pointer group"
            onClick={() => handleImageClick(image, index)}
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
          slides={images.map((image) => ({
            src: `https://res.cloudinary.com/${env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload/${image.public_id}`,
            alt: image.context?.custom?.alt || image.public_id,
            title: image.context?.custom?.caption,
          }))}
        />
      )}
    </>
  );
}
