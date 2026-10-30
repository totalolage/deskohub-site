import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { loadVenuePhotos } from "@/features/gallery/backend/load-venue-photos.server";
import { RoomImageCarousel } from "@/features/gallery/components/room-image-carousel";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { isMeetingRoomPageEnabled } from "@/features/meeting-room/backend/meeting-room-page-feature-flag";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";
import { getTtrpgRooms } from "@/features/ttrpg-room/ttrpg-rooms";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { textLink } from "@/shared/components/ui/text-link";

export const instant = true;

export const generateMetadata = publicPageMetadata("/ttrpg-room");

export function TtrpgRoomPage({
  locale,
  barCarousel,
  workspaceCarousel,
}: {
  locale: Locale;
  barCarousel: ReactNode;
  workspaceCarousel: ReactNode;
}) {
  return (
    <main className="min-h-[calc(100vh-var(--site-header-height))] overflow-x-clip bg-[#f4f1ea] pt-[calc(var(--site-header-height)+2.5rem)] text-navy-blue sm:pt-[calc(var(--site-header-height)+4rem)]">
      <Container className="pb-16 sm:pb-24">
        <h1 className="max-w-4xl text-5xl leading-[0.96] text-balance sm:text-7xl">
          {m.ttrpgRoomHeroTitle({}, { locale })}
        </h1>
        <p className="mt-8 max-w-3xl text-lg leading-8 text-navy-blue/74 sm:text-xl">
          {m.ttrpgRoomHeroLead({}, { locale })}
        </p>

        <section className="mt-14 grid border-y border-navy-blue/18 md:grid-cols-2 md:divide-x md:divide-navy-blue/18">
          {getTtrpgRooms(locale).map((room) => (
            <article key={room.title} className="py-10 md:px-10 first:md:pl-0">
              {{ bar: barCarousel, workspace: workspaceCarousel }[room.venue]}
              <p className="text-sm font-semibold tracking-[0.16em] text-burned-orange uppercase">
                {room.eyebrow}
              </p>
              <h2 className="mt-4 text-4xl leading-tight text-balance sm:text-5xl">
                {room.title}
              </h2>
              <p className="mt-5 text-2xl text-navy-blue/74">{room.seats}</p>
              <p className="mt-4 max-w-xl leading-7 text-navy-blue/74">
                {room.description}
              </p>
              <Button asChild size="lg" caps className="mt-8">
                <Link href={room.href}>{room.cta}</Link>
              </Button>
            </article>
          ))}
        </section>

        <section
          aria-labelledby="ttrpg-room-sessions-heading"
          className="mt-16 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-16"
        >
          <h2
            id="ttrpg-room-sessions-heading"
            className="text-4xl leading-tight text-balance sm:text-5xl"
          >
            {m.ttrpgRoomGalleryTitle({}, { locale })}
          </h2>
          <div className="space-y-5 text-lg leading-8 text-navy-blue/74">
            <p>{m.ttrpgRoomGalleryText({}, { locale })}</p>
            <p>
              {m.ttrpgRoomBookingNote({}, { locale })}{" "}
              <Link href={`/${locale}/contact`} className={textLink()}>
                {m.ttrpgRoomBookingNoteLink({}, { locale })}
              </Link>
            </p>
            <Suspense fallback={null}>
              <MeetingRoomNote locale={locale} />
            </Suspense>
          </div>
        </section>
      </Container>
    </main>
  );
}

/** Points the Workspace room's visitors at the meeting room it is, while that page is out. */
async function MeetingRoomNote({ locale }: { locale: Locale }) {
  await connection();
  if (!(await isMeetingRoomPageEnabled())) return null;

  return (
    <p>
      <Interpolate
        string={m.ttrpgRoomMeetingRoomNote({}, { locale })}
        mapping={{
          meetingRoom: (content) => (
            <Link href={`/${locale}/meeting-room`} className={textLink()}>
              {content}
            </Link>
          ),
        }}
      />
    </p>
  );
}

export default async function LocalizedTtrpgRoomPage() {
  return runWithRequestLocale((locale) => (
    <TtrpgRoomPage
      barCarousel={
        <RoomCarousel
          locale={locale}
          roomTitle={m.ttrpgRoomBarChoiceTitle({}, { locale })}
          album="ttrpg-room-bar"
        />
      }
      locale={locale}
      workspaceCarousel={
        <RoomCarousel
          locale={locale}
          roomTitle={m.ttrpgRoomWorkspaceChoiceTitle({}, { locale })}
          album="ttrpg-room-workspace"
        />
      }
    />
  ));
}

function RoomCarousel({
  locale,
  roomTitle,
  album,
}: {
  locale: Locale;
  roomTitle: string;
  album: "ttrpg-room-bar" | "ttrpg-room-workspace";
}) {
  const label = m.ttrpgRoomCarouselOpen({ roomTitle }, { locale });

  return (
    <Suspense fallback={<RoomCarouselFallback label={label} />}>
      <RoomCarouselContent label={label} locale={locale} album={album} />
    </Suspense>
  );
}

async function RoomCarouselContent({
  label,
  locale,
  album,
}: {
  label: string;
  locale: Locale;
  album: "ttrpg-room-bar" | "ttrpg-room-workspace";
}) {
  await connection();
  const images = await loadVenuePhotos(album, locale);

  return (
    <RoomImageCarousel
      emptyText={m.ttrpgRoomPhotosComingSoon({}, { locale })}
      images={images}
      openLabel={label}
    />
  );
}

export function RoomCarouselFallback({ label }: { label: string }) {
  return (
    <section aria-busy="true" aria-label={label} className="mb-7 space-y-3">
      <Skeleton className="aspect-[4/3] w-full rounded-[1.25rem] bg-transparent bg-linear-to-br from-navy-blue via-navy-blue/88 to-burned-orange/42" />
      <div
        aria-hidden="true"
        className="flex min-h-10 items-center justify-center"
      >
        <Skeleton className="h-2 w-14 rounded-full bg-navy-blue/16" />
      </div>
    </section>
  );
}
