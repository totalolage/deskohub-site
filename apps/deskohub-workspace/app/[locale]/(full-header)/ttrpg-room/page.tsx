import { Effect, Option } from "effect";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  type CloudinaryAsset,
  CloudinaryServiceLive,
} from "@/features/gallery/backend/cloudinary.service";
import { getCloudinaryImages } from "@/features/gallery/backend/cloudinary-images";
import { RoomImageCarousel } from "@/features/gallery/components/room-image-carousel";
import { type Locale, locales, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { getParamsDecoder } from "@/features/i18n/server/route-params";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import {
  getWorkspaceLocalizedCanonicalUrl,
  workspaceSiteConstants,
} from "@/shared/utils";

type TtrpgRoomPageProps = {
  params: Promise<{ locale: string }>;
};

const pathname = "/ttrpg-room";
const decodeTtrpgRoomParams = getParamsDecoder({});

const getContactHref = (href: string, message: string) => {
  const searchParams = new URLSearchParams({ message });

  return `${href}?${searchParams.toString()}#contact-form`;
};

const getRoomImages = (
  tags: readonly ["ttrpg-room", "ttrpg-room-bar" | "ttrpg-room-workspace"]
) =>
  getCloudinaryImages({ tags: [tags] }).pipe(
    Effect.catch(() => Effect.succeed([] as readonly CloudinaryAsset[]))
  );

export async function generateMetadata({
  params,
}: TtrpgRoomPageProps): Promise<Metadata> {
  const routeParams = Option.getOrUndefined(
    decodeTtrpgRoomParams(await params)
  );
  if (!routeParams) notFound();
  const { locale } = routeParams;

  return runWithRequestLocale(locale, () => {
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

function TtrpgRoomPage({
  locale,
  barImages,
  workspaceImages,
}: {
  locale: Locale;
  barImages: readonly CloudinaryAsset[];
  workspaceImages: readonly CloudinaryAsset[];
}) {
  const localePath = `/${locale}`;
  const rooms = [
    {
      eyebrow: m.ttrpgRoomBarRoomLabel({}, { locale }),
      title: m.ttrpgRoomBarChoiceTitle({}, { locale }),
      seats: m.ttrpgRoomBarCapacity({}, { locale }),
      images: barImages,
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
      images: workspaceImages,
      href: getContactHref(
        `${localePath}/contact`,
        m.ttrpgRoomWorkspacePrefillMessage({}, { locale })
      ),
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
              <RoomImageCarousel
                emptyText={m.ttrpgRoomPhotosComingSoon({}, { locale })}
                images={room.images}
                openLabel={m.ttrpgRoomCarouselOpen({}, { locale })}
              />
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

export default WorkspaceEffect.page(
  { operation: "ttrpg-room.render" },
  ({ params }: TtrpgRoomPageProps) =>
    Effect.gen(function* () {
      const routeParams = Option.getOrUndefined(
        decodeTtrpgRoomParams(yield* Effect.promise(() => params))
      );
      if (!routeParams) return yield* Effect.sync(() => notFound());
      const { locale } = routeParams;
      const [barImages, workspaceImages] = yield* Effect.all(
        [
          getRoomImages(["ttrpg-room", "ttrpg-room-bar"]),
          getRoomImages(["ttrpg-room", "ttrpg-room-workspace"]),
        ],
        { concurrency: "inherit" }
      ).pipe(
        Effect.provide(CloudinaryServiceLive),
        Effect.catch(() =>
          Effect.succeed([[], []] as const satisfies readonly [
            readonly CloudinaryAsset[],
            readonly CloudinaryAsset[],
          ])
        )
      );

      return runWithRequestLocale(locale, () => (
        <TtrpgRoomPage
          barImages={barImages}
          locale={locale}
          workspaceImages={workspaceImages}
        />
      ));
    })
);
