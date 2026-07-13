"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { motion, type Transition } from "motion/react";
import { useMemo, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  useMotionSwipeCarousel,
  wrapIndex,
} from "@/features/gallery/hooks/use-motion-swipe-carousel";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";

type TtrpgRoomImageCarouselProps = {
  images: readonly CloudinaryAsset[];
  emptyText: string;
  openLabel: string;
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

const getAssetLabel = (asset: CloudinaryAsset) =>
  asset.context?.custom?.caption?.trim() ||
  asset.context?.custom?.alt?.trim() ||
  asset.public_id;

export function TtrpgRoomImageCarousel({
  images,
  emptyText,
  openLabel,
}: TtrpgRoomImageCarouselProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
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
    count: images.length,
    getSwipeDistance: (stageWidth) => stageWidth,
  });
  const activeImage = images[activeIndex];
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

  const visibleSlides = (images.length === 1 ? [0] : slideOffsets).map(
    (offset) => {
      const virtualIndex = currentVirtualIndex + offset;

      return {
        image: images[wrapIndex(virtualIndex, images.length)]!,
        isCurrent: offset === 0,
        offset: virtualIndex - visibleVirtualIndex,
        virtualIndex,
      };
    }
  );

  return (
    <section
      aria-label={openLabel}
      className="mb-7 space-y-3"
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
        className="relative aspect-[4/3] w-full touch-pan-y overflow-hidden rounded-[1.25rem] bg-navy-blue"
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
          const logicalIndex = wrapIndex(virtualIndex, images.length);

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
              <CloudinaryImage
                source={image}
                className="absolute inset-0 transition duration-300 group-hover:scale-[1.025]"
                draggable={false}
                preload={logicalIndex === activeIndex}
                size={{ width: "fill", height: "fill" }}
                sizes="(min-width: 768px) 42vw, 100vw"
                variant="gallery"
              />
              {image.context?.custom?.caption && (
                <span className="absolute inset-x-0 bottom-0 bg-linear-to-t from-navy-blue/78 to-transparent px-4 pb-3 pt-12 text-sm font-medium text-white">
                  {image.context.custom.caption}
                </span>
              )}
            </motion.button>
          );
        })}
      </motion.div>

      <div className="flex min-h-10 items-center justify-center">
        <CarouselPositionIndicator
          activeIndex={activeIndex}
          count={images.length}
          getKey={(dotIndex) => images[dotIndex]?.public_id ?? dotIndex}
          getLabel={(dotIndex) => getAssetLabel(images[dotIndex]!)}
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
