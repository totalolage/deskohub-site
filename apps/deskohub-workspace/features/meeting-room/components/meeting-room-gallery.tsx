"use client";

import { CloudinaryImage } from "@deskohub/cloudinary-image";
import { useMemo, useState } from "react";
import Lightbox from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";
import { type Locale, m } from "@/features/i18n";
import { UnstyledButton } from "@/shared/components/ui/unstyled-button";

type MeetingRoomGalleryProps = {
  images: readonly VenuePhoto[];
  locale: Locale;
};

export function MeetingRoomGallery({
  images,
  locale,
}: MeetingRoomGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);
  const lightboxSlides = useMemo(
    () => images.map((image) => image.lightbox),
    [images]
  );

  return (
    <section
      aria-labelledby="meeting-room-gallery-heading"
      className="bg-silver text-navy-blue"
      id="meeting-room-gallery"
    >
      <div className="mx-auto w-full max-w-8xl px-4 py-24 sm:px-6 sm:py-32 lg:px-8 xl:px-14">
        <div className="mb-14 max-w-[53.75rem] sm:mb-18">
          <p className="mb-7 font-mono text-[0.6875rem] font-semibold uppercase tracking-[0.13em] text-burned-orange-ink">
            {m.meetingRoomGalleryEyebrow({}, { locale })}
          </p>
          <h2
            className="text-[clamp(3.125rem,5.4vw,5.75rem)] leading-[0.96] tracking-[-0.06em]"
            id="meeting-room-gallery-heading"
          >
            {m.meetingRoomGalleryTitle({}, { locale })}
          </h2>
        </div>

        {images.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-5 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {images.map((image, index) => {
              const { alt, caption, detail } = image;
              const imageName = alt || caption;

              return (
                <figure className="m-0 min-w-0" key={image.id}>
                  <UnstyledButton
                    aria-label={
                      imageName
                        ? m.meetingRoomGalleryOpenImage(
                            { image: imageName },
                            { locale }
                          )
                        : m.meetingRoomGalleryOpenNumberedImage(
                            { number: index + 1 },
                            { locale }
                          )
                    }
                    className="group relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden rounded-[1.375rem] bg-navy-blue/8 p-0 text-left focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-burned-orange"
                    onClick={() => setLightboxIndex(index)}
                  >
                    <CloudinaryImage
                      alt={alt}
                      className="absolute inset-0 size-full object-cover transition-transform duration-300 group-hover:scale-[1.025] group-focus-visible:scale-[1.025]"
                      preload={false}
                      sizes="(min-width: 1280px) 30vw, (min-width: 768px) 48vw, 100vw"
                      size={{ width: "fill", height: "fill" }}
                      source={image.publicId}
                      variant="gallery"
                    />
                  </UnstyledButton>
                  {(caption || detail) && (
                    <figcaption className="flex items-center justify-between gap-5 px-1 pb-2 pt-4 font-mono text-[0.625rem] uppercase tracking-[0.08em]">
                      {caption && (
                        <span className="text-burned-orange-ink">
                          {String(index + 1).padStart(2, "0")} / {caption}
                        </span>
                      )}
                      {detail && (
                        <strong className="ml-auto text-right font-medium text-navy-blue/58">
                          {detail}
                        </strong>
                      )}
                    </figcaption>
                  )}
                </figure>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-[1.375rem] border border-dashed border-navy-blue/24 bg-white/28 px-6 text-center text-sm text-navy-blue/62">
            {m.meetingRoomPhotosComingSoon({}, { locale })}
          </div>
        )}
      </div>

      <Lightbox
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        open={lightboxIndex >= 0}
        slides={lightboxSlides}
      />
    </section>
  );
}
