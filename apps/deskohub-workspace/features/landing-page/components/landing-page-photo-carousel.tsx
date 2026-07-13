"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { motion, type Transition } from "motion/react";
import { use, useMemo, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  useMotionSwipeCarousel,
  wrapIndex,
} from "@/features/gallery/hooks/use-motion-swipe-carousel";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";

type LandingPagePhotoCarouselProps = {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  autoPlayInterval?: number;
  className?: string;
};

const slideOffsets = [-2, -1, 0, 1, 2] as const;
type SlideOffset = (typeof slideOffsets)[number];

const slideSpring: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 32,
  mass: 0.8,
};

const slideTransition: Transition = {
  default: slideSpring,
  filter: { duration: 0.2, ease: "easeOut" },
  opacity: { duration: 0.2, ease: "easeOut" },
  zIndex: { duration: 0.28, ease: "linear" },
};

const dotTransition: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
};

const instantTransition: Transition = {
  duration: 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const interpolateAnchoredValue = (
  offset: number,
  values: readonly number[]
) => {
  const clampedOffset = clamp(offset, slideOffsets[0], slideOffsets.at(-1)!);

  for (let index = 0; index < slideOffsets.length - 1; index++) {
    const startOffset = slideOffsets[index]!;
    const endOffset = slideOffsets[index + 1]!;

    if (clampedOffset > endOffset) continue;

    const progress = (clampedOffset - startOffset) / (endOffset - startOffset);
    return values[index]! + (values[index + 1]! - values[index]!) * progress;
  }

  return values.at(-1)!;
};

const getSlideMotion = (offset: number) => {
  const brightness = interpolateAnchoredValue(
    offset,
    [0.7, 0.82, 1, 0.82, 0.7]
  );

  return {
    filter: `brightness(${brightness})`,
    opacity: interpolateAnchoredValue(offset, [0, 0.86, 1, 0.86, 0]),
    rotate: interpolateAnchoredValue(offset, [-2.5, -1.5, 0, 1.5, 2.5]),
    scale: interpolateAnchoredValue(offset, [0.68, 0.72, 1, 0.72, 0.68]),
    x: `${interpolateAnchoredValue(offset, [-132, -82, -50, -18, 32])}%`,
    y: "-50%",
    zIndex: getSlideZIndex(offset),
  };
};

const getSlideZIndex = (offset: number) => {
  if (Math.abs(offset) < 0.5) return 20;
  if (Math.abs(offset) < 1.5) return 10;

  return 0;
};

const AUTO_PLAY_INTERVAL = 3600;
export function LandingPagePhotoCarousel({
  imagesPromise,
  autoPlayInterval = AUTO_PLAY_INTERVAL,
  className,
}: LandingPagePhotoCarouselProps) {
  const images = use(imagesPromise);
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
    moveToVirtualIndex,
    setIsFocusWithin,
    setIsPointerOver,
    shouldReduceMotion,
    shouldSuppressClickAfterSwipe,
    stageRef,
    startDrag,
    virtualIndex: currentVirtualIndex,
    visibleVirtualIndex,
  } = useMotionSwipeCarousel({
    autoPlayInterval,
    count: images.length,
  });
  const activeSlideTransition = shouldReduceMotion
    ? instantTransition
    : isSwiping
      ? instantTransition
      : slideTransition;
  const activeDotTransition = shouldReduceMotion
    ? instantTransition
    : dotTransition;
  const lightboxAnimation = shouldReduceMotion
    ? { fade: 0, navigation: 0, swipe: 0 }
    : undefined;

  const hasImages = images.length > 0;
  const openLightbox = (index: number) => {
    setLightboxIndex(index);
  };
  const lightboxSlides: SlideImage[] = useMemo(
    () =>
      images.map((image) => ({
        alt: image.context?.custom?.alt ?? image.public_id,
        description: image.context?.custom?.caption,
        height: image.height,
        src: image.secure_url,
        title: image.context?.custom?.caption,
        width: image.width,
      })),
    [images]
  );
  const visibleOffsets: readonly SlideOffset[] =
    images.length === 0 ? [] : images.length === 1 ? [0] : slideOffsets;
  const visibleSlides = visibleOffsets.map((offset) => {
    const virtualIndex = currentVirtualIndex + offset;
    return {
      image: images[wrapIndex(virtualIndex, images.length)]!,
      isCurrent: offset === 0,
      offset: virtualIndex - visibleVirtualIndex,
      virtualIndex,
    };
  });

  if (!hasImages) return null;

  return (
    <section
      aria-label="Deskohub workspace photo carousel"
      className={cn("overflow-visible space-y-8", className)}
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
        className="relative mx-auto h-72 max-w-6xl touch-pan-y @container-[size] sm:h-112 lg:h-136"
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
          const baseOffset = virtualIndex - currentVirtualIndex;
          const logicalIndex = wrapIndex(virtualIndex, images.length);
          const isVisibleSide = Math.abs(baseOffset) === 1;
          const isVisible = isCurrent || isVisibleSide;

          return (
            <motion.button
              animate={getSlideMotion(offset)}
              aria-current={isCurrent ? "true" : undefined}
              aria-hidden={isVisible ? undefined : true}
              aria-label={
                isCurrent
                  ? `Open current carousel photo ${logicalIndex + 1} in lightbox`
                  : `Show carousel photo ${logicalIndex + 1}`
              }
              className={cn(
                "absolute left-1/2 top-1/2 aspect-16/10 w-[min(78cqw,160cqh)] select-none overflow-hidden rounded-[1.8rem] border border-white/35 bg-white/18 p-2 text-left shadow-[0_30px_90px_-48px_rgba(0,2,79,0.95)] backdrop-blur-sm focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-white sm:rounded-[2.5rem] sm:p-3",
                isCurrent
                  ? "cursor-zoom-in"
                  : isVisibleSide
                    ? "cursor-pointer"
                    : "pointer-events-none"
              )}
              disabled={!isVisible}
              draggable={false}
              initial={shouldReduceMotion ? false : getSlideMotion(offset)}
              key={virtualIndex}
              onClick={() => {
                if (shouldSuppressClickAfterSwipe()) return;

                if (isCurrent) {
                  openLightbox(logicalIndex);
                  return;
                }

                if (isVisibleSide) moveToVirtualIndex(virtualIndex);
              }}
              tabIndex={isVisible ? undefined : -1}
              transition={activeSlideTransition}
              type="button"
              whileHover={
                isVisibleSide && !shouldReduceMotion
                  ? { filter: "brightness(0.96)" }
                  : undefined
              }
              whileTap={
                isVisibleSide && !shouldReduceMotion
                  ? { opacity: 0.72 }
                  : undefined
              }
            >
              <div className="relative h-full overflow-hidden rounded-[1.25rem] bg-navy-blue sm:rounded-[1.85rem]">
                <CloudinaryImage
                  source={image}
                  className="absolute inset-0"
                  preload={isCurrent}
                  size={{ width: "fill", height: "fill" }}
                  variant="gallery"
                />
                <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,2,79,0.18),transparent_42%,rgba(245,125,0,0.18))]" />
              </div>
            </motion.button>
          );
        })}
      </motion.div>
      <CarouselPositionIndicator
        activeIndex={activeIndex}
        className="justify-center px-4"
        count={images.length}
        getKey={(index) => images[index]?.public_id ?? index}
        getLabel={(index) => `Show carousel image ${index + 1}`}
        onSelect={moveToIndex}
        transition={activeDotTransition}
      />
      <Lightbox
        animation={lightboxAnimation}
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        open={lightboxIndex >= 0}
        slides={lightboxSlides}
      />
    </section>
  );
}
