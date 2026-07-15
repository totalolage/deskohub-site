import Link from "next/link";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import {
  RoomImageCarousel,
  type RoomImageCarouselFallbackImage,
} from "@/features/gallery/components/room-image-carousel";
import { type Locale, m } from "@/features/i18n";
import meetingRoomDetailPhoto from "@/features/landing-page/images/zasedacka/IMG_20260319_165936.jpg";
import meetingRoomMuralPhoto from "@/features/landing-page/images/zasedacka/IMG_20260319_165943.jpg";
import meetingRoomWidePhoto from "@/features/landing-page/images/zasedacka/IMG_20260418_162920.jpg";
import meetingRoomHeroPhoto from "@/features/landing-page/images/zasedacka/IMG_20260418_162934.jpg";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";

type MeetingRoomEditorialDesignProps = {
  images?: readonly CloudinaryAsset[];
  locale: Locale;
};

export function MeetingRoomEditorialDesign({
  images = [],
  locale,
}: MeetingRoomEditorialDesignProps) {
  const fallbackImages = [
    {
      alt: m.landingMeetingRoomGalleryImageOneAlt({}, { locale }),
      src: meetingRoomHeroPhoto,
    },
    {
      alt: m.landingMeetingRoomGalleryImageTwoAlt({}, { locale }),
      src: meetingRoomWidePhoto,
    },
    {
      alt: m.meetingRoomGalleryImageThreeAlt({}, { locale }),
      src: meetingRoomDetailPhoto,
    },
    {
      alt: m.meetingRoomGalleryImageFourAlt({}, { locale }),
      src: meetingRoomMuralPhoto,
    },
  ] satisfies readonly RoomImageCarouselFallbackImage[];

  return (
    <main className="overflow-x-clip bg-[#ece5d9] pt-[calc(var(--site-header-height)+1.5rem)] text-navy-blue sm:pt-[calc(var(--site-header-height)+2.5rem)]">
      <section>
        <Container className="pb-16 sm:pb-24">
          <div className="grid gap-8 lg:grid-cols-[0.86fr_1.14fr] lg:items-start lg:gap-12">
            <div>
              <h1 className="max-w-3xl text-5xl leading-[0.93] text-balance sm:text-7xl lg:text-[5.4rem]">
                {m.meetingRoomHeroTitle({}, { locale })}
              </h1>
              <p className="mt-7 max-w-xl text-lg leading-8 text-navy-blue/76 sm:text-xl">
                {m.meetingRoomChoiceText({}, { locale })}
              </p>
              <Button asChild className="mt-9 px-7 uppercase tracking-[0.08em]">
                <Link href={`/${locale}/reservation/meeting-room`}>
                  {m.meetingRoomReservationCta({}, { locale })}
                </Link>
              </Button>
            </div>

            <RoomImageCarousel
              className="mb-0 min-w-0"
              emptyText={m.meetingRoomPhotosComingSoon({}, { locale })}
              fallbackImages={fallbackImages}
              imageSizes="(min-width: 1024px) 58vw, 100vw"
              images={images}
              openLabel={m.meetingRoomCarouselOpen({}, { locale })}
              stageClassName="aspect-auto min-h-[28rem] rounded-none sm:min-h-[36rem] lg:min-h-[42rem]"
            />
          </div>

          <div className="mt-10 border-y border-navy-blue/18 py-4 text-sm font-semibold tracking-[0.08em] uppercase">
            {m.meetingRoomCapacity({}, { locale })}
          </div>
        </Container>
      </section>
    </main>
  );
}
