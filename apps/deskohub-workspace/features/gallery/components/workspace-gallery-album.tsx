"use client";

import { useMemo, useState } from "react";
import { MasonryPhotoAlbum, type Photo } from "react-photo-album";
import "react-photo-album/masonry.css";
import Lightbox, { type SlideImage } from "yet-another-react-lightbox";
import "yet-another-react-lightbox/styles.css";
import type { GalleryPhoto } from "../types/gallery-photo";

type WorkspaceAlbumPhoto = Photo & GalleryPhoto;

type WorkspaceGalleryAlbumProps = {
  photos: readonly GalleryPhoto[];
};

const eagerGalleryImageCount = 3;

export function WorkspaceGalleryAlbum({ photos }: WorkspaceGalleryAlbumProps) {
  const [lightboxIndex, setLightboxIndex] = useState(-1);

  const albumPhotos: readonly WorkspaceAlbumPhoto[] = useMemo(
    () =>
      photos.map((photo) => ({
        ...photo,
        key: photo.id,
        label: `Open ${photo.caption ?? photo.alt} in lightbox`,
        title: photo.caption,
      })),
    [photos]
  );

  const lightboxSlides: SlideImage[] = useMemo(
    () =>
      photos.map((photo) => ({
        alt: photo.alt,
        description: photo.caption,
        height: photo.height,
        src: photo.fullSrc,
        title: photo.caption,
        width: photo.width,
      })),
    [photos]
  );

  return (
    <>
      <MasonryPhotoAlbum<WorkspaceAlbumPhoto>
        columns={(containerWidth) => {
          if (containerWidth < 520) return 1;
          if (containerWidth < 900) return 2;
          return 3;
        }}
        componentsProps={{
          button: () => ({
            className:
              "group relative isolate cursor-zoom-in overflow-hidden rounded-[1.35rem] bg-white p-0 text-left shadow-[0_24px_70px_-50px_rgba(0,2,79,0.72)] ring-1 ring-navy-blue/8 transition duration-300 focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-chilean-fire hover:shadow-[0_30px_80px_-48px_rgba(0,2,79,0.82)]",
          }),
          image: ({ index, photo }) => ({
            alt: photo.alt,
            className:
              "rounded-[1.35rem] object-cover transition duration-500 group-hover:scale-[1.025] group-focus-visible:scale-[1.025]",
            fetchPriority: index < eagerGalleryImageCount ? "high" : "auto",
            loading: index < eagerGalleryImageCount ? "eager" : "lazy",
            sizes:
              "(max-width: 639px) calc(100vw - 32px), (max-width: 1023px) calc((100vw - 72px) / 2), 352px",
          }),
        }}
        defaultContainerWidth={1088}
        onClick={({ index }) => setLightboxIndex(index)}
        photos={albumPhotos}
        render={{
          image: (
            { alt, className, fetchPriority, loading, sizes, src, style },
            { height, photo, width }
          ) => (
            // biome-ignore lint/performance/noImgElement: react-photo-album controls rendered dimensions; Next/Image warns when its generated sizing is constrained by album CSS.
            <img
              alt={alt ?? photo.alt}
              className={className}
              decoding="async"
              fetchPriority={fetchPriority}
              height={height}
              loading={loading}
              sizes={sizes}
              src={src}
              style={style}
              width={width}
            />
          ),
          extras: (_, { photo }) =>
            !!photo.caption && (
              <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-navy-blue/78 via-navy-blue/28 to-transparent px-4 pb-3 pt-12 text-sm font-medium leading-5 text-white opacity-95">
                {photo.caption}
              </figcaption>
            ),
        }}
        sizes={{
          size: "352px",
          sizes: [
            { viewport: "(max-width: 639px)", size: "calc(100vw - 32px)" },
            {
              viewport: "(max-width: 1023px)",
              size: "calc((100vw - 72px) / 2)",
            },
          ],
        }}
        spacing={(containerWidth) => (containerWidth < 640 ? 14 : 18)}
      />

      <Lightbox
        close={() => setLightboxIndex(-1)}
        index={lightboxIndex}
        open={lightboxIndex >= 0}
        slides={lightboxSlides}
      />
    </>
  );
}
