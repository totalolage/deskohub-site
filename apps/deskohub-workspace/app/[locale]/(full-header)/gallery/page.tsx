import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getCloudinaryImages } from "@/features/gallery/actions/get-cloudinary-images";
import { GalleryErrorBoundary } from "@/features/gallery/components/gallery-error-boundary";
import { WorkspaceGalleryAlbum } from "@/features/gallery/components/workspace-gallery-album";
import { toGalleryPhotos } from "@/features/gallery/types/gallery-photo";
import { isLocale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { Container } from "@/shared/components/container";

type GalleryPageProps = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({
  params,
}: GalleryPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => ({
    title: m.galleryMetadataTitle({}, { locale }),
    description: m.galleryMetadataDescription({}, { locale }),
    robots: { index: false, follow: false },
  }));
}

export default async function GalleryPage({ params }: GalleryPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return runWithRequestLocale(locale, () => (
    <Gallery>
      <GalleryErrorBoundary>
        <GalleryContent />
      </GalleryErrorBoundary>
    </Gallery>
  ));
}

function Gallery({ children }: { children: ReactNode }) {
  return (
    <main className="mt-(--site-header-height) min-h-dvh overflow-x-clip bg-[#f4f1ea] text-navy-blue">
      <h1 className="sr-only">{m.gallerySrTitle()}</h1>
      <section className="relative isolate py-6 sm:py-8 lg:py-10">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_12%_8%,rgba(236,164,35,0.22),transparent_30%),radial-gradient(circle_at_88%_18%,rgba(221,72,10,0.16),transparent_28%),linear-gradient(180deg,#f4f1ea_0%,#ffffff_48%,#f4f1ea_100%)]"
        />
        <Container className="max-w-7xl">{children}</Container>
      </section>
    </main>
  );
}

async function GalleryContent() {
  const assets = await getCloudinaryImages({
    tags: ["gallery"],
    maxResults: 80,
  });
  const photos = toGalleryPhotos(assets);

  return photos.length > 0 ? (
    <WorkspaceGalleryAlbum photos={photos} />
  ) : (
    <EmptyGallery assetsCount={assets.length} />
  );
}

function EmptyGallery({ assetsCount }: { assetsCount: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="min-h-64 rounded-[1.35rem] bg-linear-to-br from-white via-[#f8efe3] to-burned-orange/24 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <div className="min-h-80 rounded-[1.35rem] bg-linear-to-br from-[#fff9ef] via-white to-navy-blue/18 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <div className="min-h-56 rounded-[1.35rem] bg-linear-to-br from-white via-sunset-yellow/20 to-chilean-fire/28 shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8" />
      <p className="sm:col-span-3 rounded-[1.35rem] border border-navy-blue/10 bg-white/72 px-5 py-4 text-sm text-navy-blue/70 shadow-[0_18px_60px_-46px_rgba(0,2,79,0.7)] backdrop-blur">
        {assetsCount === 0
          ? m.galleryEmptyNoPhotos()
          : m.galleryEmptyMissingMetadata()}
      </p>
    </div>
  );
}
