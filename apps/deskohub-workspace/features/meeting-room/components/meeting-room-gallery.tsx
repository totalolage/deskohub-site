import { CloudinaryImage } from "@deskohub/cloudinary-image";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { type Locale, m } from "@/features/i18n";

type MeetingRoomGalleryProps = {
  images: readonly CloudinaryAsset[];
  locale: Locale;
};

export function MeetingRoomGallery({
  images,
  locale,
}: MeetingRoomGalleryProps) {
  const photos = [
    {
      alt: m.meetingRoomGalleryImageOneAlt({}, { locale }),
      detail: m.meetingRoomGalleryImageOneDetail({}, { locale }),
      label: m.meetingRoomGalleryImageOneLabel({}, { locale }),
    },
    {
      alt: m.meetingRoomGalleryImageTwoAlt({}, { locale }),
      detail: m.meetingRoomGalleryImageTwoDetail({}, { locale }),
      label: m.meetingRoomGalleryImageTwoLabel({}, { locale }),
    },
    {
      alt: m.meetingRoomGalleryImageThreeAlt({}, { locale }),
      detail: m.meetingRoomGalleryImageThreeDetail({}, { locale }),
      label: m.meetingRoomGalleryImageThreeLabel({}, { locale }),
    },
    {
      alt: m.meetingRoomGalleryImageFourAlt({}, { locale }),
      detail: m.meetingRoomGalleryImageFourDetail({}, { locale }),
      label: m.meetingRoomGalleryImageFourLabel({}, { locale }),
    },
    {
      alt: m.meetingRoomGalleryImageFiveAlt({}, { locale }),
      detail: m.meetingRoomGalleryImageFiveDetail({}, { locale }),
      label: m.meetingRoomGalleryImageFiveLabel({}, { locale }),
    },
  ] as const;
  const visiblePhotos = photos.slice(0, images.length);

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

        {visiblePhotos.length > 0 ? (
          <div className="grid grid-cols-1 gap-x-5 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
            {visiblePhotos.map((photo, index) => (
              <figure className="m-0 min-w-0" key={images[index]!.public_id}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[1.375rem] bg-navy-blue/8">
                  <CloudinaryImage
                    alt={photo.alt}
                    className="absolute inset-0 size-full object-cover transition-transform duration-300 hover:scale-[1.025]"
                    preload={false}
                    sizes="(min-width: 1280px) 30vw, (min-width: 768px) 48vw, 100vw"
                    size={{ width: "fill", height: "fill" }}
                    source={images[index]!}
                    variant="gallery"
                  />
                </div>
                <figcaption className="flex items-center justify-between gap-5 px-1 pb-2 pt-4 font-mono text-[0.625rem] uppercase tracking-[0.08em]">
                  <span className="text-burned-orange-ink">
                    {String(index + 1).padStart(2, "0")} / {photo.label}
                  </span>
                  <strong className="text-right font-medium text-navy-blue/58">
                    {photo.detail}
                  </strong>
                </figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-[1.375rem] border border-dashed border-navy-blue/24 bg-white/28 px-6 text-center text-sm text-navy-blue/62">
            {m.meetingRoomPhotosComingSoon({}, { locale })}
          </div>
        )}
      </div>
    </section>
  );
}
