"use client";

import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { use, useEffect, useState } from "react";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { getImageAlt } from "../utils/get-image-alt";
import {
  GalleryHeaderControls,
  GalleryHeaderText,
} from "./gallery-header-overlay";
import { nextSlideIndex, previousSlideIndex } from "./gallery-header-slides";

interface GalleryHeaderProps {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  title?: string;
  description?: string;
  autoPlayInterval?: number;
}

export function GalleryHeader({
  imagesPromise,
  title,
  description,
  autoPlayInterval = 3000,
}: GalleryHeaderProps) {
  const images = use(imagesPromise);
  const locale = useLocale();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const autoPlays = !isPaused && images.length > 1;

  // Auto-advance slides
  useEffect(() => {
    if (!autoPlays) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => nextSlideIndex(prev, images.length));
    }, autoPlayInterval);
    return () => clearInterval(timer);
  }, [autoPlays, images.length, autoPlayInterval]);

  if (images.length === 0) {
    return null;
  }

  const haveText = !!(title || description);

  return (
    <section
      className="relative w-full h-[400px] overflow-hidden bg-gray-900"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      aria-label="Image carousel"
    >
      {/* Image Slider */}
      <div
        className="flex transition-transform duration-500 ease-in-out h-full"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {images.map((image) => (
          <div key={image.public_id} className="relative min-w-full h-full">
            <CloudinaryImage
              source={image}
              alt={getImageAlt(image, locale)}
              variant="hero"
              priority={images.indexOf(image) === 0}
            />
            {/* Gradient overlay for better text visibility */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
          </div>
        ))}
      </div>

      {/* Unified Overlay */}
      <div className="absolute inset-0 flex flex-col pointer-events-none">
        {haveText && (
          <GalleryHeaderText title={title} description={description} />
        )}

        {images.length > 1 && (
          <GalleryHeaderControls
            images={images}
            currentIndex={currentIndex}
            haveText={haveText}
            onPrevious={() =>
              setCurrentIndex((prev) => previousSlideIndex(prev, images.length))
            }
            onNext={() =>
              setCurrentIndex((prev) => nextSlideIndex(prev, images.length))
            }
            onSelect={setCurrentIndex}
          />
        )}
      </div>
    </section>
  );
}
