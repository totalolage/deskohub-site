"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { motion, type Transition } from "motion/react";
import { useMemo, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import {
  useMotionSwipeCarousel,
  wrapIndex,
} from "@/features/gallery/hooks/use-motion-swipe-carousel";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { type Locale, m } from "@/features/i18n";
import { CarouselPositionIndicator } from "@/shared/components/carousel-position-indicator";
import { cn } from "@/shared/utils";
import "yet-another-react-lightbox/styles.css";

type LandingPagePhotoCarouselProps = {
  ariaLabel: string;
  locale: Locale;
  images: readonly VenuePhoto[];
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

/** A single photo shows alone; no photos show nothing. */
const getVisibleSlideOffsets = (count: number): readonly SlideOffset[] => {
  if (count === 0) return [];
  return count === 1 ? [0] : slideOffsets;
};

export function LandingPagePhotoCarousel({
  ariaLabel,
  images,
  locale,
  className,
}: LandingPagePhotoCarouselProps) {
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
    shouldReduceMotion,
    shouldSuppressClickAfterSwipe,
    stageRef,
    startDrag,
    virtualIndex: currentVirtualIndex,
    visibleVirtualIndex,
  } = useMotionSwipeCarousel({
    count: images.length,
  });
  const activeSlideTransition =
    shouldReduceMotion || isSwiping ? instantTransition : slideTransition;
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
  const lightboxSlides = useMemo(
    () => images.map((image) => image.lightbox),
    [images]
  );
  const visibleSlides = getVisibleSlideOffsets(images.length).map((offset) => {
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
      aria-label={ariaLabel}
      className={cn("overflow-visible space-y-8", className)}
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
        {visibleSlides.map(({ image, isCurrent, offset, virtualIndex }) => (
          <LandingPagePhotoCarouselSlide
            image={image}
            key={virtualIndex}
            locale={locale}
            logicalIndex={wrapIndex(virtualIndex, images.length)}
            offset={offset}
            onMove={() => moveToVirtualIndex(virtualIndex)}
            onOpen={openLightbox}
            slideRole={getSlideRole(
              isCurrent,
              virtualIndex - currentVirtualIndex
            )}
            shouldReduceMotion={shouldReduceMotion}
            shouldSuppressClick={shouldSuppressClickAfterSwipe}
            transition={activeSlideTransition}
          />
        ))}
      </motion.div>
      <div className="flex flex-wrap items-center justify-center gap-2 px-4">
        <CarouselPositionIndicator
          activeIndex={activeIndex}
          count={images.length}
          getKey={(index) => images[index]?.id ?? index}
          getLabel={(index) =>
            m.landingCarouselShowImage({ number: index + 1 }, { locale })
          }
          onSelect={moveToIndex}
          transition={activeDotTransition}
        />
      </div>
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

/**
 * A slide's place in the stage: the current slide opens the lightbox, a
 * slide beside it moves the carousel there, and the rest stay inert.
 */
type SlideRole = "current" | "side" | "hidden";

const getSlideRole = (isCurrent: boolean, baseOffset: number): SlideRole => {
  if (isCurrent) return "current";
  return Math.abs(baseOffset) === 1 ? "side" : "hidden";
};

const slideCursorClassNames = {
  current: "cursor-zoom-in",
  side: "cursor-pointer",
  hidden: "pointer-events-none",
} satisfies Record<SlideRole, string>;

/** Hover and press feedback, only on a side slide and only with motion. */
const getSlideFeedback = (
  role: SlideRole,
  shouldReduceMotion: boolean | null
) =>
  role === "side" && !shouldReduceMotion
    ? {
        whileHover: { filter: "brightness(0.96)" },
        whileTap: { opacity: 0.72 },
      }
    : { whileHover: undefined, whileTap: undefined };

const getSlideLabel = (role: SlideRole, number: number, locale: Locale) =>
  role === "current"
    ? m.landingCarouselOpenCurrentPhoto({ number }, { locale })
    : m.landingCarouselShowPhoto({ number }, { locale });

function LandingPagePhotoCarouselSlide({
  image,
  locale,
  logicalIndex,
  offset,
  onMove,
  onOpen,
  slideRole,
  shouldReduceMotion,
  shouldSuppressClick,
  transition,
}: {
  readonly image: VenuePhoto;
  readonly locale: Locale;
  readonly logicalIndex: number;
  readonly offset: number;
  readonly onMove: () => void;
  readonly onOpen: (index: number) => void;
  readonly slideRole: SlideRole;
  readonly shouldReduceMotion: boolean | null;
  readonly shouldSuppressClick: () => boolean;
  readonly transition: Transition;
}) {
  const isCurrent = slideRole === "current";
  const isVisible = slideRole !== "hidden";

  return (
    <motion.button
      animate={getSlideMotion(offset)}
      aria-current={isCurrent ? "true" : undefined}
      aria-hidden={isVisible ? undefined : true}
      aria-label={getSlideLabel(slideRole, logicalIndex + 1, locale)}
      className={cn(
        "absolute left-1/2 top-1/2 aspect-16/10 w-[min(78cqw,160cqh)] select-none overflow-hidden rounded-[1.8rem] border border-white/35 bg-white/18 p-2 text-left shadow-[0_30px_90px_-48px_rgba(0,2,79,0.95)] backdrop-blur-sm focus-visible:outline focus-visible:outline-offset-4 focus-visible:outline-white sm:rounded-[2.5rem] sm:p-3",
        slideCursorClassNames[slideRole]
      )}
      disabled={!isVisible}
      draggable={false}
      initial={shouldReduceMotion ? false : getSlideMotion(offset)}
      onClick={() => {
        if (shouldSuppressClick()) return;

        if (isCurrent) {
          onOpen(logicalIndex);
          return;
        }

        if (slideRole === "side") onMove();
      }}
      tabIndex={isVisible ? undefined : -1}
      transition={transition}
      type="button"
      {...getSlideFeedback(slideRole, shouldReduceMotion)}
    >
      <span className="relative block h-full overflow-hidden rounded-[1.25rem] bg-navy-blue sm:rounded-[1.85rem]">
        <CloudinaryImage
          source={image.publicId}
          alt={image.alt}
          className="absolute inset-0"
          size={{ width: "fill", height: "fill" }}
          // The current slide's width: 78% of the content box, capped
          // by the stage height at each breakpoint.
          sizes="(min-width: 64rem) min(78vw, 823px), (min-width: 40rem) min(78vw, 691px), min(78vw, 443px)"
          variant="gallery"
        />
        <span className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,2,79,0.18),transparent_42%,rgba(245,125,0,0.18))]" />
      </span>
    </motion.button>
  );
}
