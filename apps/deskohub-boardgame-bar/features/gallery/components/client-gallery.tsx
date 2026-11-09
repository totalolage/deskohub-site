"use client";

import { track } from "@vercel/analytics";
import { use, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";
import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { getImageAlt } from "../utils/get-image-alt";
import {
  type GalleryImage,
  GalleryImageCard,
  LightboxSlide,
  MinimalGallery,
} from "./client-gallery-items";
import {
  type GalleryColumns,
  galleryColumnClasses,
  lightboxOpenTrackingData,
} from "./client-gallery-layout";

interface ClientGalleryProps {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  blurUrlsPromise?: Promise<Record<CloudinaryAsset["public_id"], string>>;
  variant?: "grid" | "minimal";
  columns?: GalleryColumns;
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
  const locale = useLocale();

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);

  const galleryImages = images.map(
    (image): GalleryImage => ({
      source: image,
      alt: getImageAlt(image, locale),
      blurDataURL: blurUrls?.[image.public_id],
    })
  );

  if (variant === "minimal") {
    return <MinimalGallery images={galleryImages} className={className} />;
  }

  if (!images.length) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">No images available at the moment.</p>
      </div>
    );
  }

  const openLightbox = (image: CloudinaryAsset, index: number) => {
    if (!enableLightbox) return;
    setLightboxIndex(index);
    setLightboxOpen(true);
    track("Gallery Lightbox Open", lightboxOpenTrackingData(image, index));
  };

  return (
    <>
      <div
        className={cn(
          "grid grid-cols-1 gap-4",
          galleryColumnClasses(columns),
          className
        )}
      >
        {galleryImages.map((image, index) => (
          <GalleryImageCard
            key={image.source.public_id}
            image={image}
            onClick={() => openLightbox(image.source, index)}
          />
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
            slide: ({ slide, rect }) => (
              <LightboxSlide
                image={galleryImages[Number(slide.src)]!}
                container={rect}
              />
            ),
          }}
        />
      )}
    </>
  );
}
