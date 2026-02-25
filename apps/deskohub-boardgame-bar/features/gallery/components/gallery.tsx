import type { ComponentProps } from "react";
import { generateBlurDataUrlCached } from "../actions/generate-blur-data-url";
import { ClientGallery } from "./client-gallery";

/**
 * Server component that enriches images with blur data URLs
 */
export async function Gallery({
  imagesPromise,
  ...props
}: Omit<ComponentProps<typeof ClientGallery>, "blurUrlsPromise">) {
  const blurUrlsPromise = imagesPromise.then((images) =>
    Promise.all(
      images.map(async (image) => [
        image.public_id,
        await generateBlurDataUrlCached(image),
      ])
    ).then((imagesWithBlur) => Object.fromEntries(imagesWithBlur))
  );

  return (
    <ClientGallery
      imagesPromise={imagesPromise}
      blurUrlsPromise={blurUrlsPromise}
      {...props}
    />
  );
}
