"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { useMemo, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";

type TtrpgRoomImageCarouselProps = {
  images: readonly CloudinaryAsset[];
  emptyText: string;
  openLabel: string;
};

const wrapIndex = (index: number, length: number) =>
  ((index % length) + length) % length;

const getAssetLabel = (asset: CloudinaryAsset) =>
  asset.context?.custom?.caption?.trim() ||
  asset.context?.custom?.alt?.trim() ||
  asset.public_id;

export function TtrpgRoomImageCarousel({
  images,
  emptyText,
  openLabel,
}: TtrpgRoomImageCarouselProps) {
  const [index, setIndex] = useState(0);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const activeIndex = images.length > 0 ? wrapIndex(index, images.length) : 0;
  const activeImage = images[activeIndex];
  const slides: SlideImage[] = useMemo(
    () =>
      images.map((image) => ({
        alt: image.context?.custom?.alt || image.public_id,
        description: image.context?.custom?.caption,
        height: image.height,
        src: image.secure_url,
        title: image.context?.custom?.caption,
        width: image.width,
      })),
    [images]
  );

  if (!activeImage) {
    return (
      <div className="mb-7 grid aspect-[4/3] place-items-center rounded-[1.25rem] border border-dashed border-navy-blue/24 bg-white/36 px-6 text-center text-sm text-navy-blue/62">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="mb-7 space-y-3">
      <button
        aria-label={openLabel}
        className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-[1.25rem] bg-navy-blue text-left focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-burned-orange"
        onClick={() => setLightboxIndex(activeIndex)}
        type="button"
      >
        <CloudinaryImage
          asset={activeImage}
          className="absolute inset-0 transition duration-300 group-hover:scale-[1.025]"
          preload={activeIndex === 0}
          size={{ width: "fill", height: "fill" }}
          sizes="(min-width: 768px) 42vw, 100vw"
          variant="gallery"
        />
        {activeImage.context?.custom?.caption && (
          <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-navy-blue/78 to-transparent px-4 pb-3 pt-12 text-sm font-medium text-white">
            {activeImage.context.custom.caption}
          </span>
        )}
      </button>

      <div className="flex min-h-10 items-center justify-center">
        <CarouselPositionIndicator
          activeIndex={activeIndex}
          count={images.length}
          getKey={(dotIndex) => images[dotIndex]?.public_id ?? dotIndex}
          getLabel={(dotIndex) => getAssetLabel(images[dotIndex]!)}
          onSelect={setIndex}
          variant="navy"
        />
      </div>

      <Lightbox
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        open={lightboxIndex >= 0}
        slides={slides}
      />
    </div>
  );
}
