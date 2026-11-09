import type { CloudinaryAsset } from "@deskohub/cloudinary";

/** Grid columns per breakpoint; a missing breakpoint keeps the smaller one's. */
export interface GalleryColumns {
  sm?: number;
  md?: number;
  lg?: number;
  xl?: number;
}

const columnBreakpoints = ["sm", "md", "lg", "xl"] as const;

/** Tailwind grid column classes for each breakpoint that sets a count. */
export const galleryColumnClasses = (columns: GalleryColumns) =>
  columnBreakpoints.map(
    (breakpoint) =>
      columns[breakpoint] && `${breakpoint}:grid-cols-${columns[breakpoint]}`
  );

interface Size {
  width: number;
  height: number;
}

/** The largest size with the image's aspect ratio that fits the container. */
export const fitImageToContainer = (
  image: Pick<CloudinaryAsset, "width" | "height">,
  container: Size
): Size => {
  const imageAspectRatio = image.width / image.height;
  const containerAspectRatio = container.width / container.height;

  return imageAspectRatio > containerAspectRatio
    ? { width: container.width, height: container.width / imageAspectRatio }
    : { width: container.height * imageAspectRatio, height: container.height };
};

/** The caption an editor gave the image in Cloudinary, if any. */
export const galleryImageCaption = (image: CloudinaryAsset) =>
  image.context?.custom?.caption;

/** Analytics properties for opening the image at `index` in the lightbox. */
export const lightboxOpenTrackingData = (
  image: CloudinaryAsset,
  index: number
) => {
  const trackData: Record<string, string | number> = {
    imageId: image.public_id,
    imageIndex: index,
  };
  const caption = galleryImageCaption(image);
  if (caption) {
    trackData.imageCaption = caption;
  }
  return trackData;
};
