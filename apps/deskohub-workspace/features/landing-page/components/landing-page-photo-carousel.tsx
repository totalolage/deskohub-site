"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { motion, type Transition, useReducedMotion } from "motion/react";
import { use, useEffect, useMemo, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";

type LandingPagePhotoCarouselProps = {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
  autoPlayInterval?: number;
  className?: string;
};

const wrapIndex = (index: number, length: number) =>
  ((index % length) + length) % length;

const getClosestVirtualIndex = (
  targetIndex: number,
  currentIndex: number,
  length: number
) => {
  const currentLogicalIndex = wrapIndex(currentIndex, length);
  let delta = targetIndex - currentLogicalIndex;

  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;

  return currentIndex + delta;
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

const getSlideMotion = (offset: SlideOffset) => {
  if (offset <= -2) {
    return {
      filter: "brightness(0.7)",
      opacity: 0,
      rotate: -2.5,
      scale: 0.68,
      x: "-132%",
      y: "-50%",
      zIndex: getSlideZIndex(offset),
    };
  }
  if (offset < 0) {
    return {
      filter: "brightness(0.82)",
      opacity: 0.86,
      rotate: -1.5,
      scale: 0.72,
      x: "-82%",
      y: "-50%",
      zIndex: getSlideZIndex(offset),
    };
  }
  if (offset >= 2) {
    return {
      filter: "brightness(0.7)",
      opacity: 0,
      rotate: 2.5,
      scale: 0.68,
      x: "32%",
      y: "-50%",
      zIndex: getSlideZIndex(offset),
    };
  }
  if (offset > 0) {
    return {
      filter: "brightness(0.82)",
      opacity: 0.86,
      rotate: 1.5,
      scale: 0.72,
      x: "-18%",
      y: "-50%",
      zIndex: getSlideZIndex(offset),
    };
  }

  return {
    filter: "brightness(1)",
    opacity: 1,
    rotate: 0,
    scale: 1,
    x: "-50%",
    y: "-50%",
    zIndex: getSlideZIndex(offset),
  };
};

const getSlideZIndex = (offset: SlideOffset) => {
  if (offset === 0) return 20;
  if (Math.abs(offset) === 1) return 10;

  return 0;
};

const AUTO_PLAY_INTERVAL = 10000;
export function LandingPagePhotoCarousel({
  imagesPromise,
  className,
}: LandingPagePhotoCarouselProps) {
  const images = use(imagesPromise);
  const shouldReduceMotion = useReducedMotion();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const isPaused = isPointerOver || isFocusWithin;
  const activeSlideTransition = shouldReduceMotion
    ? instantTransition
    : slideTransition;
  const activeDotTransition = shouldReduceMotion
    ? instantTransition
    : dotTransition;
  const lightboxAnimation = shouldReduceMotion
    ? { fade: 0, navigation: 0, swipe: 0 }
    : undefined;

  useEffect(() => {
    if (images.length <= 1 || isPaused || shouldReduceMotion) return;

    const interval = setInterval(() => {
      setCurrentIndex((index) => index + 1);
    }, AUTO_PLAY_INTERVAL);

    return () => clearInterval(interval);
  }, [images.length, isPaused, shouldReduceMotion]);

  const hasImages = images.length > 0;
  const currentLogicalIndex = hasImages
    ? wrapIndex(currentIndex, images.length)
    : 0;
  const moveToVirtualIndex = (nextIndex: number) => {
    setCurrentIndex(nextIndex);
  };
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
    const virtualIndex = currentIndex + offset;
    return {
      image: images[wrapIndex(virtualIndex, images.length)]!,
      isCurrent: offset === 0,
      offset,
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
      <div className="relative mx-auto h-72 max-w-6xl @container-[size] sm:h-112 lg:h-136">
        {visibleSlides.map(({ image, isCurrent, offset, virtualIndex }) => {
          const isVisibleSide = Math.abs(offset) === 1;
          const isVisible = isCurrent || isVisibleSide;

          return (
            <motion.button
              animate={getSlideMotion(offset)}
              aria-current={isCurrent ? "true" : undefined}
              aria-hidden={isVisible ? undefined : true}
              aria-label={
                isCurrent
                  ? `Open current carousel photo ${currentLogicalIndex + 1} in lightbox`
                  : `Show carousel photo ${wrapIndex(virtualIndex, images.length) + 1}`
              }
              className={cn(
                "absolute left-1/2 top-1/2 aspect-16/10 w-[min(78cqw,160cqh)] overflow-hidden rounded-[1.8rem] border border-white/35 bg-white/18 p-2 text-left shadow-[0_30px_90px_-48px_rgba(0,2,79,0.95)] backdrop-blur-sm focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-white sm:rounded-[2.5rem] sm:p-3",
                isCurrent
                  ? "cursor-zoom-in"
                  : isVisibleSide
                    ? "cursor-pointer"
                    : "pointer-events-none"
              )}
              disabled={!isVisible}
              initial={shouldReduceMotion ? false : getSlideMotion(offset)}
              key={virtualIndex}
              onClick={() => {
                const logicalIndex = wrapIndex(virtualIndex, images.length);

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
                  asset={image}
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
      </div>
      {images.length > 1 && (
        <div className="flex justify-center gap-2 px-4">
          {images.map((image, index) => (
            <motion.button
              animate={{ width: index === currentLogicalIndex ? 40 : 10 }}
              aria-label={`Show carousel image ${index + 1}`}
              className={cn(
                "h-2.5 rounded-full border border-white/50 bg-white/45 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white",
                index === currentLogicalIndex ? "bg-white" : "hover:bg-white/75"
              )}
              key={image.public_id}
              onClick={() =>
                moveToVirtualIndex(
                  getClosestVirtualIndex(index, currentIndex, images.length)
                )
              }
              transition={activeDotTransition}
              type="button"
            />
          ))}
        </div>
      )}
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
