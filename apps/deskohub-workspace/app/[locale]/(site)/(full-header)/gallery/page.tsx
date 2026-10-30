import Interpolate from "@doist/react-interpolate";
import Link from "next/link";
import { connection } from "next/server";
import { type ReactNode, Suspense } from "react";
import { loadVenuePhotos } from "@/features/gallery/backend/load-venue-photos.server";
import { GalleryErrorBoundary } from "@/features/gallery/components/gallery-error-boundary";
import { WorkspaceGalleryAlbum } from "@/features/gallery/components/workspace-gallery-album";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { publicPageMetadata } from "@/features/public-pages/backend/public-page-route.server";
import { getCoworkReservationPath } from "@/features/reservation/routes";
import { Container } from "@/shared/components/container";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { textLink } from "@/shared/components/ui/text-link";

export const instant = true;

export const generateMetadata = publicPageMetadata("/gallery");

export default async function GalleryPage() {
  return runWithRequestLocale((locale) => (
    <Gallery locale={locale}>
      <GalleryErrorBoundary>
        <Suspense fallback={<GalleryFallback locale={locale} />}>
          <GalleryContent locale={locale} />
        </Suspense>
      </GalleryErrorBoundary>
    </Gallery>
  ));
}

function Gallery({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  return (
    <main className="mt-(--site-header-height) min-h-dvh overflow-x-clip bg-[#f4f1ea] text-navy-blue">
      <section className="relative isolate py-6 sm:py-8 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(236,164,35,0.22),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(221,72,10,0.16),transparent_28%),linear-gradient(180deg,#f4f1ea_0%,#ffffff_48%,#f4f1ea_100%)]"
        />
        <Container className="max-w-7xl">
          <header className="mb-6 max-w-3xl pt-4 sm:mb-8 sm:pt-6">
            <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
              {m.galleryPageTitle({}, { locale })}
            </h1>
            <p className="mt-4 text-lg leading-8 text-navy-blue/74">
              <Interpolate
                string={m.galleryPageIntro({}, { locale })}
                mapping={{
                  coworking: (content) => (
                    <Link href={`/${locale}/coworking`} className={textLink()}>
                      {content}
                    </Link>
                  ),
                  reservation: (content) => (
                    <Link
                      href={getCoworkReservationPath(locale)}
                      className={textLink()}
                    >
                      {content}
                    </Link>
                  ),
                }}
              />
            </p>
          </header>
          {children}
        </Container>
      </section>
    </main>
  );
}

async function GalleryContent({ locale }: { readonly locale: Locale }) {
  await connection();
  const photos = await loadVenuePhotos("gallery", locale);

  return photos.length > 0 ? (
    <WorkspaceGalleryAlbum locale={locale} photos={photos} />
  ) : (
    <EmptyGallery locale={locale} />
  );
}

function GalleryFallback({ locale }: { readonly locale: Locale }) {
  return (
    <section
      aria-busy="true"
      aria-label={m.gallerySrTitle({}, { locale })}
      className="grid gap-4 sm:grid-cols-3"
    >
      <Skeleton className="min-h-64 rounded-[1.35rem] bg-transparent bg-linear-to-br from-white via-[#f8efe3] to-burned-orange/24 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <Skeleton className="min-h-80 rounded-[1.35rem] bg-transparent bg-linear-to-br from-[#fff9ef] via-white to-navy-blue/18 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <Skeleton className="min-h-56 rounded-[1.35rem] bg-transparent bg-linear-to-br from-white via-sunset-yellow/20 to-chilean-fire/28 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
    </section>
  );
}

function EmptyGallery({ locale }: { readonly locale: Locale }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="min-h-64 rounded-[1.35rem] bg-linear-to-br from-white via-[#f8efe3] to-burned-orange/24 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <div className="min-h-80 rounded-[1.35rem] bg-linear-to-br from-[#fff9ef] via-white to-navy-blue/18 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <div className="min-h-56 rounded-[1.35rem] bg-linear-to-br from-white via-sunset-yellow/20 to-chilean-fire/28 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <p className="sm:col-span-3 rounded-[1.35rem] border border-navy-blue/10 bg-white/72 px-5 py-4 text-sm text-navy-blue/70 shadow-[0_18px_60px_-46px_rgba(0,2,79,0.7)] backdrop-blur">
        {m.galleryEmptyNoPhotos({}, { locale })}
      </p>
    </div>
  );
}
