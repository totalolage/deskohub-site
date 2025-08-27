"use client";

import { use, useEffect, useRef, useState } from "react";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { CloudinaryImage } from "./cloudinary-image";

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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout>(undefined);

  // Auto-advance slides
  useEffect(() => {
    if (!isPaused && images.length > 1) {
      intervalRef.current = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % images.length);
      }, autoPlayInterval);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [currentIndex, isPaused, images.length, autoPlayInterval]);

  const goToSlide = (index: number) => {
    setCurrentIndex(index);
  };

  const goToPrevious = () => {
    setCurrentIndex((prev) => (prev - 1 + images.length) % images.length);
  };

  const goToNext = () => {
    setCurrentIndex((prev) => (prev + 1) % images.length);
  };

  if (images.length === 0) {
    return null;
  }

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
              asset={image}
              variant="full"
              size={{ width: "fill", height: "fill" }}
              className="object-cover"
              priority={images.indexOf(image) === 0}
            />
            {/* Gradient overlay for better text visibility */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-transparent" />
          </div>
        ))}
      </div>

      {/* Navigation Arrows */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={goToPrevious}
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full transition-colors"
            aria-label="Previous image"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <button
            type="button"
            onClick={goToNext}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full transition-colors"
            aria-label="Next image"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </>
      )}

      {/* Dot Indicators */}
      {images.length > 1 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
          {images.map((image, index) => (
            <button
              type="button"
              key={`slide-${image.public_id}`}
              onClick={() => goToSlide(index)}
              className={`h-2 rounded-full transition-all ${
                index === currentIndex
                  ? "w-8 bg-white"
                  : "w-2 bg-white/50 hover:bg-white/70"
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Title Overlay */}
      {(title || description) && (
        <div className="absolute top-0 left-0 right-0 p-8 text-white bg-black/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto">
            {title && (
              <h1 className="text-4xl md:text-5xl font-bold mb-2 drop-shadow-lg">
                {title}
              </h1>
            )}
            {description && (
              <p className="text-lg md:text-xl opacity-90 drop-shadow-lg">
                {description}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
