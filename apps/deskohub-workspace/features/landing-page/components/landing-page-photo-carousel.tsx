"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import {
  motion,
  type PanInfo,
  type Transition,
  useDragControls,
  useMotionValue,
  useReducedMotion,
} from "motion/react";
import { use, useEffect, useMemo, useRef, useState } from "react";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";
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
  currentAnimationIndex: number,
  length: number
) => {
  const currentLogicalIndex = wrapIndex(currentAnimationIndex, length);
  let delta = targetIndex - currentLogicalIndex;

  if (delta > length / 2) delta -= length;
  if (delta < -length / 2) delta += length;

  return currentAnimationIndex + delta;
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

const swipeTimelineThreshold = 0.32;
const swipeVelocityThreshold = 520;
const swipeClickSuppressionDistance = 8;
const clickSuppressionAfterSwipeMs = 180;

const instantTransition: Transition = {
  duration: 0,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const truncateTowardZero = (value: number) =>
  value < 0 ? Math.ceil(value) : Math.floor(value);

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
  className,
}: LandingPagePhotoCarouselProps) {
  const images = use(imagesPromise);
  const shouldReduceMotion = useReducedMotion();
  const [animationTimelineIndex, setAnimationTimelineIndex] = useState(0);
  const [swipeTimelineOffset, setSwipeTimelineOffset] = useState(0);
  const [isPointerOver, setIsPointerOver] = useState(false);
  const [isFocusWithin, setIsFocusWithin] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const dragControls = useDragControls();
  const dragX = useMotionValue(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const animationTimelineIndexRef = useRef(animationTimelineIndex);
  const dragStartAnimationTimelineIndexRef = useRef(animationTimelineIndex);
  const lastSwipeAtRef = useRef(0);
  const isPaused = isPointerOver || isFocusWithin || isDragging;
  const isSwiping = swipeTimelineOffset !== 0;
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

  useEffect(() => {
    animationTimelineIndexRef.current = animationTimelineIndex;
  }, [animationTimelineIndex]);

  useEffect(() => {
    if (images.length <= 1 || isPaused || shouldReduceMotion) return;

    const interval = setInterval(() => {
      setAnimationTimelineIndex((index) => {
        const nextIndex = index + 1;

        animationTimelineIndexRef.current = nextIndex;

        return nextIndex;
      });
    }, AUTO_PLAY_INTERVAL);

    return () => clearInterval(interval);
  }, [images.length, isPaused, shouldReduceMotion]);

  const hasImages = images.length > 0;
  const visibleTimelineIndex = animationTimelineIndex + swipeTimelineOffset;
  const currentLogicalIndex = hasImages
    ? wrapIndex(Math.round(visibleTimelineIndex), images.length)
    : 0;
  const moveToAnimationIndex = (nextIndex: number) => {
    animationTimelineIndexRef.current = nextIndex;
    setAnimationTimelineIndex(nextIndex);
    setSwipeTimelineOffset(0);
  };
  const openLightbox = (index: number) => {
    setLightboxIndex(index);
  };
  const getSwipeTimelineDistance = () => {
    const stageWidth = stageRef.current?.clientWidth ?? 0;

    return Math.max(96, Math.min(stageWidth * 0.28, 260));
  };
  const resetDragCarrier = () => {
    dragX.stop();
    dragX.set(0);
  };
  const applyDragOffset = (offsetX: number) => {
    const rawTimelineOffset = -offsetX / getSwipeTimelineDistance();
    const wholeSteps = truncateTowardZero(rawTimelineOffset);
    const fractionalOffset = rawTimelineOffset - wholeSteps;
    const nextIndex = dragStartAnimationTimelineIndexRef.current + wholeSteps;

    if (nextIndex !== animationTimelineIndexRef.current) {
      animationTimelineIndexRef.current = nextIndex;
      setAnimationTimelineIndex(nextIndex);
    }

    setSwipeTimelineOffset(fractionalOffset);
  };
  const handleDragStart = () => {
    if (images.length <= 1) return;

    dragStartAnimationTimelineIndexRef.current =
      animationTimelineIndexRef.current;
    resetDragCarrier();
    setIsDragging(true);
    setSwipeTimelineOffset(0);
  };
  const handleDragMove = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (images.length <= 1) return;

    const absX = Math.abs(info.offset.x);
    const absY = Math.abs(info.offset.y);

    if (absX <= absY) {
      setSwipeTimelineOffset(0);
      return;
    }

    if (absX >= swipeClickSuppressionDistance) {
      lastSwipeAtRef.current = Date.now();
    }

    applyDragOffset(info.offset.x);
  };
  const handleDragEnd = (
    _: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    if (images.length <= 1) return;

    const rawTimelineOffset = -info.offset.x / getSwipeTimelineDistance();
    const wholeSteps = truncateTowardZero(rawTimelineOffset);
    const fractionalOffset = rawTimelineOffset - wholeSteps;
    const isHorizontalDrag =
      Math.abs(info.offset.x) >= swipeClickSuppressionDistance &&
      Math.abs(info.offset.x) > Math.abs(info.offset.y);
    let nextIndex = dragStartAnimationTimelineIndexRef.current + wholeSteps;

    if (isHorizontalDrag) lastSwipeAtRef.current = Date.now();

    if (!isHorizontalDrag) {
      moveToAnimationIndex(dragStartAnimationTimelineIndexRef.current);
      resetDragCarrier();
      setIsDragging(false);
      return;
    }

    if (
      fractionalOffset >= swipeTimelineThreshold ||
      info.velocity.x <= -swipeVelocityThreshold
    ) {
      nextIndex += 1;
    } else if (
      fractionalOffset <= -swipeTimelineThreshold ||
      info.velocity.x >= swipeVelocityThreshold
    ) {
      nextIndex -= 1;
    }

    moveToAnimationIndex(nextIndex);
    resetDragCarrier();
    setIsDragging(false);
  };
  const shouldSuppressClickAfterSwipe = () =>
    Date.now() - lastSwipeAtRef.current < clickSuppressionAfterSwipeMs;
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
    const virtualIndex = animationTimelineIndex + offset;
    return {
      image: images[wrapIndex(virtualIndex, images.length)]!,
      isCurrent: offset === 0,
      offset: virtualIndex - visibleTimelineIndex,
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
        onPointerDownCapture={(event) => {
          if (images.length <= 1 || event.button !== 0) return;

          dragControls.start(event);
        }}
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
          const baseOffset = virtualIndex - animationTimelineIndex;
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

                if (isVisibleSide) moveToAnimationIndex(virtualIndex);
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
      </motion.div>
      <CarouselPositionIndicator
        activeIndex={currentLogicalIndex}
        className="justify-center px-4"
        count={images.length}
        getKey={(index) => images[index]?.public_id ?? index}
        getLabel={(index) => `Show carousel image ${index + 1}`}
        onSelect={(index) =>
          moveToAnimationIndex(
            getClosestVirtualIndex(index, animationTimelineIndex, images.length)
          )
        }
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
