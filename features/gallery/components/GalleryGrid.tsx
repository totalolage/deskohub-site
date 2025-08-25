"use client";

import { CldImage } from "next-cloudinary";
import { useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import { env } from "@/env";
import { Card } from "@/shared/components/ui/card";
import type { CloudinaryAsset } from "../backend/cloudinary.service";

interface GalleryGridProps {
  images: readonly CloudinaryAsset[];
  onImageClick?: (image: CloudinaryAsset) => void;
  columns?: {
    sm?: number;
    md?: number;
    lg?: number;
    xl?: number;
  };
}

export function GalleryGrid({
  images,
  onImageClick,
  columns = {
    sm: 2,
    md: 3,
    lg: 4,
  },
}: GalleryGridProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const handleImageClick = (image: CloudinaryAsset, index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
    onImageClick?.(image);
  };
  if (images.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No images available at the moment.</p>
      </div>
    );
  }

  const gridClasses = `grid grid-cols-1 gap-4 ${
    columns.sm ? `sm:grid-cols-${columns.sm}` : ""
  } ${columns.md ? `md:grid-cols-${columns.md}` : ""} ${
    columns.lg ? `lg:grid-cols-${columns.lg}` : ""
  } ${columns.xl ? `xl:grid-cols-${columns.xl}` : ""}`;

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
              <CldImage
                src={image.public_id}
                alt={image.context?.custom?.alt || image.public_id}
                width={400}
                height={400}
                crop="fill"
                gravity="auto"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
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
    </>
  );
}
