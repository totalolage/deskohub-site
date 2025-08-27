import type { ComponentProps } from "react";
import type { CloudinaryAsset } from "../backend/cloudinary.service";
import { generateBlurDataUrl } from "../utils/generate-blur-data-url";
import { ClientGallery } from "./client-gallery";

export interface CloudinaryAssetWithBlur extends CloudinaryAsset {
  blurDataUrl?: string;
}

interface GalleryProps extends ComponentProps<typeof ClientGallery> {
  imagesPromise: Promise<readonly CloudinaryAsset[]>;
}

/**
 * Server component that enriches images with blur data URLs
 */
export async function Gallery({ imagesPromise, ...props }: GalleryProps) {
  const imagesWithBlurPromise = imagesPromise.then((images) =>
    Promise.all(
      images.map(async (image) => ({
        ...image,
        blurDataUrl: await generateBlurDataUrl(image),
      }))
    )
  );

  return <ClientGallery imagesPromise={imagesWithBlurPromise} {...props} />;
}
