import type { CloudinaryAsset } from "@deskohub/cloudinary";
import { generateBlurDataUrlCached } from "@/features/gallery/actions/generate-blur-data-url";
import { getCloudinaryImageByPublicId } from "@/features/gallery/backend/get-cloudinary-image-by-public-id.server";

export type ScheduleEventImages = {
  image: {
    desktop: CloudinaryAsset | undefined;
    mobile: CloudinaryAsset | undefined;
  };
  blurDataURL: {
    desktop: string | undefined;
    mobile: string | undefined;
  };
};

/** Loads an image's blur placeholder; a missing image or failed load has none. */
export const loadBlurDataURL = async (
  image: CloudinaryAsset | undefined
): Promise<string | undefined> =>
  image ? generateBlurDataUrlCached(image).catch(() => undefined) : undefined;

/**
 * Loads a schedule event's desktop image and its `-mobile` variant, each with
 * its blur placeholder.
 */
export const loadScheduleEventImages = async (
  imagePublicId: string
): Promise<ScheduleEventImages> => {
  const desktopImage = await getCloudinaryImageByPublicId(imagePublicId);
  const mobileImage = await getCloudinaryImageByPublicId(
    `${imagePublicId}-mobile`
  );
  const [desktopBlurDataURL, mobileBlurDataURL] = await Promise.all([
    loadBlurDataURL(desktopImage),
    loadBlurDataURL(mobileImage),
  ]);

  return {
    image: { desktop: desktopImage, mobile: mobileImage },
    blurDataURL: { desktop: desktopBlurDataURL, mobile: mobileBlurDataURL },
  };
};
