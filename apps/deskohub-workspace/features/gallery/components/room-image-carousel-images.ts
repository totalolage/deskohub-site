import type { StaticImageData } from "next/image";
import type { SlideImage } from "yet-another-react-lightbox";
import type { VenuePhoto } from "@/features/gallery/types/venue-photo";

export type RoomImageCarouselFallbackImage = {
  alt: string;
  caption?: string;
  src: StaticImageData;
};

export type RoomImageCarouselImage =
  | {
      alt: string;
      caption?: string;
      height: number;
      id: string;
      kind: "cloudinary";
      label: string;
      source: string;
      lightbox: SlideImage;
      width: number;
    }
  | {
      alt: string;
      caption?: string;
      height: number;
      id: string;
      kind: "static";
      label: string;
      source: StaticImageData;
      lightbox: SlideImage;
      width: number;
    };

/** The room's fallback images, or the single fallback image when given. */
const fallbackImageList = ({
  fallbackImages,
  fallbackImage,
  fallbackImageAlt,
}: {
  fallbackImages?: readonly RoomImageCarouselFallbackImage[] | undefined;
  fallbackImage?: StaticImageData | undefined;
  fallbackImageAlt?: string | undefined;
}): readonly RoomImageCarouselFallbackImage[] =>
  fallbackImages ??
  (fallbackImage
    ? [
        {
          alt: fallbackImageAlt ?? "",
          src: fallbackImage,
        },
      ]
    : []);

const venueCarouselImage = (image: VenuePhoto): RoomImageCarouselImage => ({
  alt: image.alt,
  caption: image.caption,
  height: image.height,
  id: image.id,
  kind: "cloudinary",
  label: image.caption || image.alt,
  source: image.publicId,
  lightbox: image.lightbox,
  width: image.width,
});

/** A fallback image, labelled by its caption, its alt, or its position. */
const staticCarouselImage = (
  image: RoomImageCarouselFallbackImage,
  index: number,
  openLabel: string
): RoomImageCarouselImage => ({
  alt: image.alt,
  caption: image.caption,
  height: image.src.height,
  id: image.src.src,
  kind: "static",
  label:
    image.caption?.trim() || image.alt.trim() || `${openLabel} ${index + 1}`,
  source: image.src,
  lightbox: {
    alt: image.alt,
    description: image.caption,
    height: image.src.height,
    src: image.src.src,
    title: image.caption,
    width: image.src.width,
  },
  width: image.src.width,
});

/** The carousel's photos: the room's venue photos, else its fallback images. */
export const roomCarouselImages = (input: {
  images: readonly VenuePhoto[];
  openLabel: string;
  fallbackImages?: readonly RoomImageCarouselFallbackImage[] | undefined;
  fallbackImage?: StaticImageData | undefined;
  fallbackImageAlt?: string | undefined;
}): readonly RoomImageCarouselImage[] =>
  input.images.length > 0
    ? input.images.map(venueCarouselImage)
    : fallbackImageList(input).map((image, index) =>
        staticCarouselImage(image, index, input.openLabel)
      );
