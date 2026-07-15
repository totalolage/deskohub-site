"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { motion, type Transition } from "motion/react";
import Image, { type StaticImageData } from "next/image";
import { useMemo, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  useMotionSwipeCarousel,
  wrapIndex,
} from "@/features/gallery/hooks/use-motion-swipe-carousel";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";
import { cn } from "@/shared/utils";

type RoomImageCarouselProps = {
  images: readonly CloudinaryAsset[];
  emptyText: string;
  openLabel: string;
  fallbackImages?: readonly RoomImageCarouselFallbackImage[];
  fallbackImage?: StaticImageData;
  fallbackImageAlt?: string;
  className?: string;
  stageClassName?: string;
  imageSizes?: string;
};

export type RoomImageCarouselFallbackImage = {
  alt: string;
  caption?: string;
  src: StaticImageData;
};

type RoomImageCarouselImage =
  | {
      alt: string;
      caption?: string;
      height: number;
      id: string;
      kind: "cloudinary";
      source: CloudinaryAsset;
      src: string;
      width: number;
    }
  | {
      alt: string;
      caption?: string;
      height: number;
      id: string;
      kind: "static";
      source: StaticImageData;
      src: string;
      width: number;
    };

const slideOffsets = [-1, 0, 1] as const;

const slideTransition: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 32,
  mass: 0.8,
};

const instantTransition: Transition = {
  duration: 0,
};

const getSlideMotion = (offset: number) => ({
  x: `${offset * 100}%`,
  zIndex: Math.abs(offset) < 0.5 ? 2 : 1,
});

const getImageLabel = (image: RoomImageCarouselImage) =>
  image.caption?.trim() || image.alt.trim() || image.id;

export function RoomImageCarousel({
  images,
  emptyText,
  openLabel,
  fallbackImages,
  fallbackImage,
  fallbackImageAlt,
  className,
  stageClassName,
  imageSizes = "(min-width: 768px) 42vw, 100vw",
}: RoomImageCarouselProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const normalizedFallbackImages =
    fallbackImages ??
    (fallbackImage
      ? [
          {
            alt: fallbackImageAlt ?? "",
            src: fallbackImage,
          },
        ]
      : []);
  const carouselImages: readonly RoomImageCarouselImage[] =
    images.length > 0
      ? images.map((image) => ({
          alt: image.context?.custom?.alt || image.public_id,
          caption: image.context?.custom?.caption,
          height: image.height,
          id: image.public_id,
          kind: "cloudinary",
          source: image,
          src: image.secure_url,
          width: image.width,
        }))
      : normalizedFallbackImages.map((image) => ({
          alt: image.alt,
          caption: image.caption,
          height: image.src.height,
          id: image.src.src,
          kind: "static",
          source: image.src,
          src: image.src.src,
          width: image.src.width,
        }));
  const {
    activeIndex,
    dragControls,
    dragX,
    handleDragEnd,
    handleDragMove,
    handleDragStart,
    isSwiping,
    moveToIndex,
    setIsFocusWithin,
    setIsPointerOver,
    shouldReduceMotion,
    shouldSuppressClickAfterSwipe,
    stageRef,
    startDrag,
    virtualIndex: currentVirtualIndex,
    visibleVirtualIndex,
  } = useMotionSwipeCarousel({
    count: carouselImages.length,
    getSwipeDistance: (stageWidth) => stageWidth,
  });
  const activeTransition = shouldReduceMotion
    ? instantTransition
    : isSwiping
      ? instantTransition
      : slideTransition;
  const lightboxAnimation = shouldReduceMotion
    ? { fade: 0, navigation: 0, swipe: 0 }
    : undefined;
  const slides: SlideImage[] = useMemo(
    () =>
      carouselImages.map((image) => ({
        alt: image.alt,
        description: image.caption,
        height: image.height,
        src: image.src,
        title: image.caption,
        width: image.width,
      })),
    [carouselImages]
  );

  if (carouselImages.length === 0) {
    return (
      <div
        className={cn(
          "mb-7 grid aspect-[4/3] place-items-center rounded-[1.25rem] border border-dashed border-navy-blue/24 bg-white/36 px-6 text-center text-sm text-navy-blue/62",
          className
        )}
      >
        {emptyText}
      </div>
    );
  }

  const visibleSlides = (carouselImages.length === 1 ? [0] : slideOffsets).map(
    (offset) => {
      const virtualIndex = currentVirtualIndex + offset;

      return {
        image: carouselImages[wrapIndex(virtualIndex, carouselImages.length)]!,
        isCurrent: offset === 0,
        offset: virtualIndex - visibleVirtualIndex,
        virtualIndex,
      };
    }
  );

  return (
    <section
      aria-label={openLabel}
      className={cn("mb-7 space-y-3", className)}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget;

        if (
          !(nextTarget instanceof Node) ||
          !event.currentTarget.contains(nextTarget)
        ) {
          setIsFocusWithin(false);
        }
      }}
      onFocus={() => setIsFocusWithin(true)}
      onPointerEnter={() => setIsPointerOver(true)}
      onPointerLeave={() => setIsPointerOver(false)}
    >
      <motion.div
        className={cn(
          "relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-[1.25rem] bg-navy-blue",
          stageClassName
        )}
        onClickCapture={(event) => {
          if (!shouldSuppressClickAfterSwipe()) return;

          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDownCapture={startDrag}
        ref={stageRef}
      >
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          drag="x"
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          onDrag={handleDragMove}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          style={{ touchAction: "pan-y", x: dragX }}
        />
        {visibleSlides.map(({ image, isCurrent, offset, virtualIndex }) => {
          const logicalIndex = wrapIndex(virtualIndex, carouselImages.length);

          return (
            <motion.button
              animate={getSlideMotion(offset)}
              aria-hidden={isCurrent ? undefined : true}
              aria-label={openLabel}
              className="group absolute inset-0 cursor-zoom-in overflow-hidden bg-navy-blue text-left focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-burned-orange"
              disabled={!isCurrent}
              draggable={false}
              initial={shouldReduceMotion ? false : getSlideMotion(offset)}
              key={virtualIndex}
              onClick={() => {
                if (shouldSuppressClickAfterSwipe()) return;

                setLightboxIndex(logicalIndex);
              }}
              tabIndex={isCurrent ? undefined : -1}
              transition={activeTransition}
              type="button"
            >
              {image.kind === "cloudinary" ? (
                <CloudinaryImage
                  source={image.source}
                  className="absolute inset-0 transition duration-300 group-hover:scale-[1.025]"
                  draggable={false}
                  preload={logicalIndex === activeIndex}
                  size={{ width: "fill", height: "fill" }}
                  sizes={imageSizes}
                  variant="gallery"
                />
              ) : (
                <Image
                  alt={image.alt}
                  className="object-cover transition duration-300 group-hover:scale-[1.025]"
                  draggable={false}
                  fill
                  priority={logicalIndex === activeIndex}
                  sizes={imageSizes}
                  src={image.source}
                />
              )}
              {image.caption && (
                <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-linear-to-t from-navy-blue/78 to-transparent px-4 pb-3 pt-12 text-sm font-medium text-white">
                  {image.caption}
                </span>
              )}
            </motion.button>
          );
        })}
      </motion.div>

      <div className="flex min-h-10 items-center justify-center">
        <CarouselPositionIndicator
          activeIndex={activeIndex}
          count={carouselImages.length}
          getKey={(dotIndex) => carouselImages[dotIndex]?.id ?? dotIndex}
          getLabel={(dotIndex) => getImageLabel(carouselImages[dotIndex]!)}
          onSelect={moveToIndex}
          variant="navy"
        />
      </div>

      <Lightbox
        animation={lightboxAnimation}
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        open={lightboxIndex >= 0}
        slides={slides}
      />
    </section>
  );
}
