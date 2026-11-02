import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { CloudinaryImage } from "@deskohub/cloudinary-image";
import type { ComponentProps } from "react";
import { Card } from "@/shared/components/ui/card";
import {
  fitImageToContainer,
  galleryImageCaption,
} from "./client-gallery-layout";

/** A gallery image with its localized alt text and blur placeholder. */
export interface GalleryImage {
  source: CloudinaryAsset;
  alt: string;
  blurDataURL: string | undefined;
}

/** Round, preloaded images in up to three columns; nothing without images. */
export function MinimalGallery({
  images,
  className,
}: {
  images: readonly GalleryImage[];
  className: string;
}) {
  if (!images.length) return null;
  return (
    <div className={`grid grid-cols-1 md:grid-cols-3 gap-8 ${className}`}>
      {images.map((image) => (
        <div
          key={image.source.public_id}
          className="rounded-full overflow-hidden aspect-square"
        >
          <CloudinaryImage
            source={image.source}
            alt={image.alt}
            blurDataURL={image.blurDataURL}
            variant="gallery"
            preload
          />
        </div>
      ))}
    </div>
  );
}

/** A clickable thumbnail card with the image's caption below it. */
export function GalleryImageCard({
  image,
  onClick,
}: {
  image: GalleryImage;
  onClick: ComponentProps<typeof Card>["onClick"];
}) {
  const caption = galleryImageCaption(image.source);
  return (
    <Card
      className="overflow-hidden transition-shadow hover:shadow-lg cursor-pointer group"
      onClick={onClick}
    >
      <div className="relative aspect-square overflow-hidden">
        <CloudinaryImage
          source={image.source}
          alt={image.alt}
          blurDataURL={image.blurDataURL}
          variant="thumbnail"
        />
      </div>
      {caption && (
        <div className="p-3">
          <p className="text-sm text-gray-600">{caption}</p>
        </div>
      )}
    </Card>
  );
}

/** The full image centered in the lightbox, as large as the slide allows. */
export function LightboxSlide({
  image,
  container,
}: {
  image: GalleryImage;
  container: { width: number; height: number };
}) {
  return (
    <div className="relative w-full h-full flex items-center justify-center">
      <CloudinaryImage
        source={image.source}
        alt={image.alt}
        blurDataURL={image.blurDataURL}
        variant="full"
        size={fitImageToContainer(image.source, container)}
      />
    </div>
  );
}
