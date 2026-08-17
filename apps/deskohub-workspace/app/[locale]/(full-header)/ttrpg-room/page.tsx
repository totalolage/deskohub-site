import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import type { CloudinaryAsset } from "@/features/gallery/backend/cloudinary.service";
import { RoomImageCarousel } from "@/features/gallery/components/room-image-carousel";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getMeetingRoomReservationPath } from "@/features/reservation/routes";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import { Skeleton } from "@/shared/components/ui/skeleton";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

const pathname = "/ttrpg-room";

export const instant = true;

const getContactHref = (href: string, message: string) => {
  const searchParams = new URLSearchParams({ message });

  return `${href}?${searchParams.toString()}#contact-form`;
};

const getRoomImages = (
  tags: readonly ["ttrpg-room", "ttrpg-room-bar" | "ttrpg-room-workspace"]
) =>
  getCloudinaryImages({ tags: [tags] }).catch(
    (): readonly CloudinaryAsset[] => []
  );

export async function generateMetadata(): Promise<Metadata> {
  return runWithRequestLocale((locale) => {
    const title = m.ttrpgRoomMetadataTitle({}, { locale });
    const description = m.ttrpgRoomMetadataDescription({}, { locale });
    const url = getWorkspaceLocalizedCanonicalUrl(locale, pathname);

    return {
      title,
      description,
      alternates: {
        canonical: url,
        languages: Object.fromEntries(
          locales.map((itemLocale) => [
            itemLocale,
            getWorkspaceLocalizedCanonicalUrl(itemLocale, pathname),
          ])
        ),
      },
      openGraph: {
        title,
        description,
        url,
        siteName: workspaceSiteConstants.brand.name,
        locale,
        type: "website",
      },
    } satisfies Metadata;
  });
}

export function TtrpgRoomPage({
  locale,
  barCarousel,
  workspaceCarousel,
}: {
  locale: Locale;
  barCarousel: ReactNode;
  workspaceCarousel: ReactNode;
}) {
  const rooms = [
    {
      eyebrow: m.ttrpgRoomBarRoomLabel({}, { locale }),
      title: m.ttrpgRoomBarChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomBarCapacity({}, { locale }),
      carousel: barCarousel,
      href: getContactHref(
        `https://bar.deskohub.cz/${locale}/contact`,
        m.ttrpgRoomBarPrefillMessage({}, { locale })
      ),
      cta: m.ttrpgRoomBarCta({}, { locale }),
    },
    {
      eyebrow: m.ttrpgRoomWorkspaceRoomLabel({}, { locale }),
      title: m.ttrpgRoomWorkspaceChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomWorkspaceCapacity({}, { locale }),
      carousel: workspaceCarousel,
      href: getMeetingRoomReservationPath(locale),
      cta: m.ttrpgRoomWorkspaceCta({}, { locale }),
    },
  ];

  return (
    <main className="min-h-[calc(100vh-var(--site-header-height))] overflow-x-clip bg-[#f4f1ea] pt-[calc(var(--site-header-height)+2.5rem)] text-navy-blue sm:pt-[calc(var(--site-header-height)+4rem)]">
      <Container className="pb-16 sm:pb-24">
        <h1 className="max-w-4xl text-5xl leading-[0.96] text-balance sm:text-7xl">
          {m.ttrpgRoomHeroTitle({}, { locale })}
        </h1>

        <section className="mt-14 grid border-y border-navy-blue/18 md:grid-cols-2 md:divide-x md:divide-navy-blue/18">
          {rooms.map((room) => (
            <article key={room.title} className="py-10 md:px-10 first:md:pl-0">
              {room.carousel}
              <p className="text-sm font-semibold tracking-[0.16em] text-burned-orange uppercase">
                {room.eyebrow}
              </p>
              <h2 className="mt-4 text-4xl leading-tight text-balance sm:text-5xl">
                {room.title}
              </h2>
              <p className="mt-5 text-2xl text-navy-blue/74">{room.seats}</p>
              <Button
                asChild
                className="mt-8 h-12 px-7 uppercase tracking-[0.08em]"
              >
                <Link href={room.href}>{room.cta}</Link>
              </Button>
            </article>
          ))}
        </section>
      </Container>
    </main>
  );
}

export default async function LocalizedTtrpgRoomPage() {
  return runWithRequestLocale((locale) => (
    <TtrpgRoomPage
      barCarousel={
        <RoomCarousel
          locale={locale}
          roomTitle={m.ttrpgRoomBarChoiceTitle({}, { locale })}
          tags={["ttrpg-room", "ttrpg-room-bar"]}
        />
      }
      locale={locale}
      workspaceCarousel={
        <RoomCarousel
          locale={locale}
          roomTitle={m.ttrpgRoomWorkspaceChoiceTitle({}, { locale })}
          tags={["ttrpg-room", "ttrpg-room-workspace"]}
        />
      }
    />
  ));
}

function RoomCarousel({
  locale,
  roomTitle,
  tags,
}: {
  locale: Locale;
  roomTitle: string;
  tags: readonly ["ttrpg-room", "ttrpg-room-bar" | "ttrpg-room-workspace"];
}) {
  const label = m.ttrpgRoomCarouselOpen({ roomTitle }, { locale });

  return (
    <Suspense fallback={<RoomCarouselFallback label={label} />}>
      <RoomCarouselContent label={label} locale={locale} tags={tags} />
    </Suspense>
  );
}

async function RoomCarouselContent({
  label,
  locale,
  tags,
}: {
  label: string;
  locale: Locale;
  tags: readonly ["ttrpg-room", "ttrpg-room-bar" | "ttrpg-room-workspace"];
}) {
  await connection();
  const images = await getRoomImages(tags);

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
